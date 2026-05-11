# sysbeat — Setup Guide

Step-by-step deployment guide for the sysbeat monitoring system. Covers development environment and production deployment.

---

## Contents

1. [Development (local development)](#development)
2. [Production (server + systemd)](#production)
3. [Troubleshooting](#troubleshooting)

---

## Development

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Linux (for running the collector)

### Step 1. Clone and install

```bash
git clone <repo-url> sysbeat
cd sysbeat
```

#### Automated setup

```bash
./setup.sh
```

This single command generates a random `INGEST_TOKEN`, creates all `.env` and `.env.local` files, and installs dependencies. Continue to step 5 to start the services.

For production: `./setup.sh --prod` (builds + deploys to `/opt/sysbeat`). With nginx: `sudo ./setup.sh --prod --install-nginx`. Full setup: `sudo ./setup.sh --prod --install-systemd --install-nginx`.

#### Manual setup

Install dependencies for all three components:

```bash
cd server && pnpm install
cd ../collector && pnpm install
cd ../dashboard && pnpm install
```

### Step 2. Configure Server

```bash
cd server
cp .env.example .env
```

Edit `.env`:

```
PORT=3000
DB_PATH=./data/sysbeat.db
INGEST_TOKEN=change-me-in-production
DASHBOARD_TOKEN=change-me-in-production
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

**Required:** change `INGEST_TOKEN` to a random string. Generate one with:

```bash
openssl rand -hex 32
```

Run:

```bash
pnpm run dev
```

Server starts at `http://localhost:3000`.

### Step 3. Configure Collector

```bash
cd collector
cp .env.example .env
```

Edit `.env`:

```
SERVER_URL=http://localhost:3000/ingest
INGEST_TOKEN=change-me-in-production   # same token as in server
DEVICE_ID=linux-device-1
INTERVAL_MS=1000
```

Run:

```bash
pnpm run dev
```

The collector starts reading `/proc` and sends metrics every second.

### Step 4. Configure Dashboard

```bash
cd dashboard
cp .env.example .env.local
```

Edit `.env.local`:

```
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
VITE_INGEST_TOKEN=change-me-in-production   # same token as in server
```

Run:

```bash
pnpm run dev
```

Opens at `http://localhost:5173`. Select a device in the selector — the charts will come alive.

### Health checks

```bash
INGEST_TOKEN="change-me-in-production"
DASHBOARD_TOKEN="change-me-in-production"

# Check health endpoint (no auth required)
curl http://localhost:3000/health

# Post a metric (requires INGEST_TOKEN)
curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","timestamp":'$(date +%s%3N)',"cpu":{"usage":10,"user":5,"system":3,"idle":82},"memory":{"total":8192,"used":4096,"free":4096,"percent":50},"load":[0.5,0.4,0.3]}' \
  http://localhost:3000/ingest

# Check device list (requires INGEST_TOKEN or DASHBOARD_TOKEN)
curl -H "Authorization: Bearer $DASHBOARD_TOKEN" http://localhost:3000/devices

# Check device metrics (requires INGEST_TOKEN or DASHBOARD_TOKEN)
curl -H "Authorization: Bearer $DASHBOARD_TOKEN" "http://localhost:3000/api/metrics/linux-device-1?resolution=raw"
```

---

## Production

### Automated deployment

```bash
# Full production setup (build + deploy + systemd + nginx)
sudo ./setup.sh --prod --install-systemd --install-nginx
```

This single command:
1. Generates a random `INGEST_TOKEN`
2. Creates all `.env` / `.env.local` files with production settings
3. Installs dependencies and builds all three components
4. Deploys built files to `/opt/sysbeat/`
5. Installs systemd services (`sysbeat-server`, `sysbeat-collector`) and starts them
6. Installs nginx, configures it to serve dashboard and proxy API/WebSocket

After setup, open `http://<server-ip>` in a browser.

Individual flags:
| Flag | Effect |
|------|--------|
| `--prod` | Build all components, deploy to `/opt/sysbeat` |
| `--install-systemd` | Install systemd services (implies `--prod`) |
| `--install-nginx` | Install nginx and configure it |
| `--device-id <id>` | Custom device ID for collector (default: hostname) |

### How it works

```
browser (http://server-ip:80)
       │
       v
      nginx (port 80)
       │        │
       │        └── /api/*, /devices, /health, /ingest, /stream → proxy → server:3000
       │
       └── /* → static files /opt/sysbeat/dashboard/dist/
```

In production the dashboard uses empty `VITE_API_URL` and `VITE_WS_URL` (same-origin). All requests go through nginx, which proxies API/WebSocket calls to the server on port 3000.

### Manual setup (without setup.sh)

Build each component:

```bash
cd server && pnpm run build
cd ../collector && pnpm run build
cd ../dashboard && pnpm run build
```

Copy to `/opt/sysbeat/` and configure nginx/systemd manually. See `nginx/sysbeat.conf` for the reference nginx configuration.

### nginx configuration reference

The setup script uses `nginx/sysbeat.conf`. Key points:
- Dashboard static files served from `/opt/sysbeat/dashboard/dist/`
- API routes (`/api/`, `/devices`, `/health`, `/ingest`) proxied to `127.0.0.1:3000`
- WebSocket (`/stream`) proxied with `Upgrade` and `Connection: upgrade` headers

---

## Environment Variables Reference

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | — | `3000` | HTTP server port |
| `DB_PATH` | — | `./data/sysbeat.db` | SQLite file path |
| `INGEST_TOKEN` | **yes** | — | Bearer token for collector writes (POST /ingest) |
| `DASHBOARD_TOKEN` | **yes** | — | Bearer token for dashboard reads (GET endpoints, WS) |
| `CORS_ORIGIN` | — | `*` | Allowed CORS origin |
| `NODE_ENV` | — | `development` | Environment |

### Collector

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SERVER_URL` | **yes** | — | Full URL to `/ingest` endpoint |
| `INGEST_TOKEN` | **yes** | — | Bearer token |
| `DEVICE_ID` | **yes** | — | Unique device identifier |
| `INTERVAL_MS` | — | `1000` | Collection interval in ms |

### Dashboard

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | — | `""` | REST API base URL (empty = same-origin, for nginx proxy mode) |
| `VITE_WS_URL` | — | `""` | WebSocket base URL (empty = same-origin) |
| `VITE_INGEST_TOKEN` | **yes** | — | Bearer token (set to server's `DASHBOARD_TOKEN` value) |

---

## Troubleshooting

### "No devices connected" in dashboard

1. Check that the collector is running and logs show `status: 200`.
2. Check `SERVER_URL` and `INGEST_TOKEN` in the collector — they must match the server's `INGEST_TOKEN`.
3. Check `curl -H "Authorization: Bearer $DASHBOARD_TOKEN" http://localhost:3000/devices` — it should return a list.
4. Verify the dashboard uses `DASHBOARD_TOKEN` (not `INGEST_TOKEN`) for `VITE_INGEST_TOKEN`.

### Dashboard cannot connect to WebSocket

1. Check `VITE_WS_URL` — in development should be `ws://localhost:3000`, in production empty (same-origin, behind nginx).
2. Check `VITE_INGEST_TOKEN` — must be set to the server's `DASHBOARD_TOKEN` (not `INGEST_TOKEN`). The token is sent as `?token=` query parameter for WebSocket auth.
3. Check DevTools → Network → WS — the connection URL must include `?token=...`. Without it, the server returns 401.
4. If behind nginx: make sure `/stream` proxies WebSocket (`Upgrade`, `Connection: upgrade`).

### "Database is locked" or "SQLITE_BUSY"

- Make sure only one server instance is running (not two processes on the same DB).
- Check that `journal_mode = WAL` is enabled (this is the default in `db.ts`).

### Collector crashes with parsing error

- Make sure you are running on Linux . `/proc` is only available on Linux.
- Check read permissions on `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`.

### better-sqlite3 native module not found

**Symptoms:** `Error: Could not locate the bindings file. Tried: .../better_sqlite3.node`

**Cause:** `better-sqlite3` is a native C++ module that must be compiled for your Node.js version. This happens when:
- Switching Node.js versions (e.g., from 20 to 22).
- A parent `pnpm-workspace.yaml` disables builds for `better-sqlite3`.

**Fix:**
```bash
# 1. Ensure build tools are installed
sudo apt install build-essential python3

# 2. server/package.json already declares "pnpm.onlyBuiltDependencies"
#    to allow better-sqlite3 builds. If you have a global
#    ~/pnpm-workspace.yaml, this setting overrides it.
#    If the problem persists, check your global workspace config.

# 3. Rebuild the native module
cd server
pnpm rebuild better-sqlite3
# If rebuild doesn't help, reinstall from scratch:
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Dashboard build fails

```bash
cd dashboard
rm -rf node_modules dist
pnpm install
pnpm run build
```

---

## Updating the system

### Updating dependencies

```bash
cd server && pnpm update
cd ../collector && pnpm update
cd ../dashboard && pnpm update
```

### Rebuilding

```bash
cd server && pnpm run build
cd ../collector && pnpm run build
cd ../dashboard && pnpm run build
```

### Restarting services

```bash
sudo systemctl restart sysbeat-server
sudo systemctl restart sysbeat-collector
```

> For the dashboard, just rebuild with `pnpm run build` — static files update instantly.
