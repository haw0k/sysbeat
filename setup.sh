#!/usr/bin/env bash
#
# sysbeat setup — automated installation and configuration
# Usage: ./setup.sh [--prod] [--install-systemd] [--device-id <id>]
#
# Options:
#   --prod             Production mode (builds all components, uses /opt/sysbeat paths)
#   --install-systemd  Install and enable systemd services (requires root)
#   --device-id <id>   Custom device ID for the collector (default: auto-detected)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PROD=false
INSTALL_SYSTEMD=false
DEVICE_ID="${HOSTNAME:-linux-device-1}"

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod) PROD=true; shift ;;
    --install-systemd) INSTALL_SYSTEMD=true; shift ;;
    --device-id) DEVICE_ID="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[setup]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[ ok ]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
log_error() { echo -e "${RED}[err ]${NC} $1"; }

# --- Prerequisites ---
log_info "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  log_error "Node.js is not installed. Install Node.js >= 20 and retry."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  log_error "Node.js >= 20 required, got $(node -v)"
  exit 1
fi
log_ok "Node.js $(node -v)"

if ! command -v pnpm &>/dev/null; then
  log_info "pnpm not found. Installing via corepack..."
  corepack enable pnpm 2>/dev/null || npm install -g pnpm
fi
log_ok "pnpm $(pnpm -v)"

# --- Token ---
log_info "Generating INGEST_TOKEN..."
INGEST_TOKEN=$(openssl rand -hex 32)
log_ok "Token: ${INGEST_TOKEN:0:16}..."

# --- Server ---
log_info "Configuring server..."

if $PROD; then
  SERVER_CORS="http://localhost"
else
  SERVER_CORS="http://localhost:5173"
fi

cat > server/.env <<EOF
PORT=3000
DB_PATH=./data/sysbeat.db
INGEST_TOKEN=${INGEST_TOKEN}
CORS_ORIGIN=${SERVER_CORS}
NODE_ENV=$( $PROD && echo "production" || echo "development" )
EOF
log_ok "server/.env created"

# --- Collector ---
log_info "Configuring collector..."

COLLECTOR_SERVER_URL="http://localhost:3000/ingest"

cat > collector/.env <<EOF
SERVER_URL=${COLLECTOR_SERVER_URL}
INGEST_TOKEN=${INGEST_TOKEN}
DEVICE_ID=${DEVICE_ID}
INTERVAL_MS=1000
EOF
log_ok "collector/.env created (device: ${DEVICE_ID})"

# --- Dashboard ---
log_info "Configuring dashboard..."

cat > dashboard/.env.local <<EOF
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
VITE_INGEST_TOKEN=${INGEST_TOKEN}
EOF
log_ok "dashboard/.env.local created"

# --- Install dependencies ---
log_info "Installing dependencies..."

for DIR in server collector dashboard; do
  log_info "  ${DIR}..."
  (
    cd "$DIR"
    # pnpm v10.12+ may exit non-zero when builds are ignored;
    # don't let set -e kill the script before we approve and rebuild.
    set +e
    pnpm install --no-frozen-lockfile
    if [ "$DIR" = "server" ]; then
      pnpm approve-builds better-sqlite3 esbuild
      pnpm rebuild better-sqlite3 esbuild
    fi
    set -e
  )
done
log_ok "Dependencies installed"

# --- Build ---
if $PROD; then
  log_info "Building all components..."

  for DIR in server collector dashboard; do
    log_info "  ${DIR}..."
    (cd "$DIR" && pnpm run build)
  done
  log_ok "Build complete"
else
  log_info "Development mode — skipping build (use --prod for production build)"
fi

# --- systemd ---
if $INSTALL_SYSTEMD; then
  if [ "$(id -u)" -ne 0 ]; then
    log_error "--install-systemd requires root. Re-run with sudo."
    exit 1
  fi

  INSTALL_DIR="/opt/sysbeat"
  SVC_DIR="/etc/systemd/system"

  log_info "Copying project to ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR"
  cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"
  chown -R root:root "$INSTALL_DIR"

  log_info "Installing systemd services..."

  # sysbeat-server.service
  cat > "${SVC_DIR}/sysbeat-server.service" <<SVCEOF
[Unit]
Description=sysbeat server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/server
ExecStart=/usr/bin/node ${INSTALL_DIR}/server/dist/server.js
Restart=always
RestartSec=5
Environment="NODE_ENV=production"
EnvironmentFile=${INSTALL_DIR}/server/.env

[Install]
WantedBy=multi-user.target
SVCEOF

  # sysbeat-collector.service
  cat > "${SVC_DIR}/sysbeat-collector.service" <<SVCCOL
[Unit]
Description=sysbeat metrics collector
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/collector
ExecStart=/usr/bin/node ${INSTALL_DIR}/collector/dist/index.js
Restart=always
RestartSec=5
Environment="NODE_ENV=production"
EnvironmentFile=${INSTALL_DIR}/collector/.env

[Install]
WantedBy=multi-user.target
SVCCOL

  systemctl daemon-reload
  systemctl enable sysbeat-server sysbeat-collector
  systemctl start sysbeat-server sysbeat-collector

  log_ok "systemd services installed and running"

  # Check status
  sleep 2
  systemctl status sysbeat-server --no-pager 2>/dev/null | head -5 || true
fi

# --- Done ---
echo ""
log_ok "Setup complete!"
echo ""
echo "  To start in development:"
echo "    cd server   && pnpm run dev"
echo "    cd collector && pnpm run dev"
echo "    cd dashboard && pnpm run dev"
echo ""
echo "  Dashboard: http://localhost:5173"
echo "  Health:    http://localhost:3000/health"
