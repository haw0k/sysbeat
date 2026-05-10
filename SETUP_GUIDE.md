# sysbeat — Setup Guide

Step-by-step deployment guide for the sysbeat monitoring system. Covers development environment and production deployment.

---

## Contents

1. [Development (local development)](#development)
2. [Production (server + systemd)](#production)
3. [Reverse Proxy (nginx)](#reverse-proxy)
4. [Troubleshooting](#troubleshooting)

---

## Development

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Linux or WSL (for running the collector)

### Step 1. Clone and install

```bash
git clone <repo-url> sysbeat
cd sysbeat
```

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
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

**Required:** change `INGEST_TOKEN` to a random string.

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
```

Run:

```bash
pnpm run dev
```

Opens at `http://localhost:5173`. Select a device in the selector — the charts will come alive.

### Development in WSL + browser on Windows

If the server and collector run in WSL and the browser is on Windows, `localhost` is different on each side. Use the WSL IP:

```bash
# Find WSL IP
hostname -I | awk '{print $1}'
# Example: 172.31.199.36
```

1. **Server**: run with `CORS_ORIGIN` pointing to the WSL IP of the dashboard:
   ```bash
   cd server
   CORS_ORIGIN=http://172.31.199.36:5173 pnpm run dev
   ```

2. **Dashboard**: in `.env.local` use WSL IP instead of `localhost`:
   ```
   VITE_API_URL=http://172.31.199.36:3000
   VITE_WS_URL=ws://172.31.199.36:3000
   ```

3. **Dashboard**: run with `--host` so Vite is accessible from outside WSL:
   ```bash
   cd dashboard
   npx vite dev --host 0.0.0.0
   ```

4. **Windows browser**: open `http://<WSL_IP>:5173/`

### Health checks

```bash
# Check health endpoint
curl http://localhost:3000/health

# Check device list
curl http://localhost:3000/devices

# Check device metrics
curl "http://localhost:3000/api/metrics/linux-device-1?resolution=raw"
```

---

## Production

### Server (production build)

```bash
cd server
pnpm run build
NODE_ENV=production pnpm start
```

Recommended to run via systemd or Docker.

### systemd service for Server

Create `/etc/systemd/system/sysbeat-server.service`:

```ini
[Unit]
Description=sysbeat server
After=network.target

[Service]
Type=simple
User=sysbeat
WorkingDirectory=/opt/sysbeat/server
ExecStart=/usr/bin/node /opt/sysbeat/server/dist/server.js
Restart=always
RestartSec=5
Environment="NODE_ENV=production"
Environment="PORT=3000"
Environment="DB_PATH=/var/lib/sysbeat/sysbeat.db"
Environment="INGEST_TOKEN=your-secret-token-here"
Environment="CORS_ORIGIN=https://sysbeat.example.com"

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/sysbeat
sudo chown sysbeat:sysbeat /var/lib/sysbeat
sudo systemctl daemon-reload
sudo systemctl enable sysbeat-server
sudo systemctl start sysbeat-server
sudo journalctl -u sysbeat-server -f
```

### Collector (production build)

```bash
cd collector
pnpm run build
```

Systemd service is described in `collector/README.md`. Briefly:

```ini
[Unit]
Description=sysbeat metrics collector
After=network.target

[Service]
Type=simple
User=sysbeat
WorkingDirectory=/opt/sysbeat/collector
ExecStart=/usr/bin/node /opt/sysbeat/collector/dist/index.js
Restart=always
RestartSec=5
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

### Dashboard (production build + static hosting)

```bash
cd dashboard
pnpm run build
```

Output goes to `dist/`. Serve via nginx, Caddy, or any static file server.

```nginx
server {
    listen 443 ssl;
    server_name sysbeat.example.com;

    root /opt/sysbeat/dashboard/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API and WebSocket to the server
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

> **Important:** in production the dashboard should query the server from the same origin (to avoid CORS issues), or the server must have `CORS_ORIGIN` set to the correct domain.

---

## Reverse Proxy

### nginx (recommended)

```nginx
upstream sysbeat {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name sysbeat.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sysbeat.example.com;

    ssl_certificate /etc/letsencrypt/live/sysbeat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sysbeat.example.com/privkey.pem;

    # Static dashboard files
    location / {
        root /opt/sysbeat/dashboard/dist;
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public, immutable";
    }

    # API + WebSocket proxy
    location /api/ {
        proxy_pass http://sysbeat;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /devices {
        proxy_pass http://sysbeat;
        proxy_http_version 1.1;
    }

    location /health {
        proxy_pass http://sysbeat;
        proxy_http_version 1.1;
    }

    location /ingest {
        proxy_pass http://sysbeat;
        proxy_http_version 1.1;
    }

    location /stream {
        proxy_pass http://sysbeat;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

### Caddy (simple alternative)

```caddy
sysbeat.example.com {
    root * /opt/sysbeat/dashboard/dist
    file_server
    try_files {path} /index.html

    reverse_proxy /api/* localhost:3000
    reverse_proxy /devices localhost:3000
    reverse_proxy /health localhost:3000
    reverse_proxy /ingest localhost:3000
    reverse_proxy /stream localhost:3000
}
```

---

## Environment Variables Reference

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | — | `3000` | HTTP server port |
| `DB_PATH` | — | `./data/sysbeat.db` | SQLite file path |
| `INGEST_TOKEN` | **yes** | — | Bearer token for POST /ingest |
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
| `VITE_API_URL` | **yes** | — | REST API base URL |
| `VITE_WS_URL` | **yes** | — | WebSocket base URL |

---

## Troubleshooting

### "No devices connected" in dashboard

1. Check that the collector is running and logs show `status: 200`.
2. Check `SERVER_URL` and `INGEST_TOKEN` in the collector — they must match the server.
3. Check `curl http://localhost:3000/devices` — it should return a list.

### Dashboard cannot connect to WebSocket

1. Check `VITE_WS_URL` — should be `ws://localhost:3000` (or `wss://` for HTTPS).
2. Check CORS: the server must allow the dashboard origin (`CORS_ORIGIN=http://localhost:5173`).
3. Check DevTools → Network → WS — is there an attempt to connect?
4. If behind nginx: make sure `/stream` proxies WebSocket (`Upgrade`, `Connection: upgrade`).

### CORS errors in WSL + Windows browser

**Cause:** `localhost` in Windows and WSL are different network interfaces. The browser sends `Origin: http://localhost:5173`, but the server in WSL sees it as `127.0.0.1` and CORS does not match.

**Solution:**
1. Use WSL IP instead of `localhost` in all configs:
   - `CORS_ORIGIN=http://172.31.199.36:5173` (server `.env`)
   - `VITE_API_URL=http://172.31.199.36:3000` (dashboard `.env.local`)
   - `VITE_WS_URL=ws://172.31.199.36:3000` (dashboard `.env.local`)
2. Run the dashboard with `--host 0.0.0.0` so it listens on all interfaces.
3. In the Windows browser open `http://<WSL_IP>:5173/`.

### "Database is locked" or "SQLITE_BUSY"

- Make sure only one server instance is running (not two processes on the same DB).
- Check that `journal_mode = WAL` is enabled (this is the default in `db.ts`).

### Collector crashes with parsing error

- Make sure you are running on Linux (or WSL). `/proc` is only available on Linux.
- Check read permissions on `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`.

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
