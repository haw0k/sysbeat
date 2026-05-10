# sysbeat-collector

Linux system metrics collector for sysbeat. Reads `/proc` filesystem and sends metrics to the sysbeat server via HTTP POST.

## Stack

- **Node.js** built-in modules only (`fs`, `https`, `http`)
- **TypeScript** strict mode
- **Zero runtime dependencies**

## Setup

```bash
cp .env.example .env
# Edit .env and set SERVER_URL, INGEST_TOKEN, DEVICE_ID
pnpm install
```

## Running

```bash
# Development (tsx + nodemon)
pnpm run dev

# Production build
pnpm run build
pnpm start
```

## Environment Variables

| Variable      | Default                 | Description                              |
|---------------|-------------------------|------------------------------------------|
| SERVER_URL    | —                       | Full URL to server /ingest endpoint      |
| INGEST_TOKEN  | —                       | Bearer token for auth                    |
| DEVICE_ID     | —                       | Unique device identifier                 |
| INTERVAL_MS   | 1000                    | Collection interval in milliseconds      |

## Metrics Collected

- **CPU**: usage, user, system, idle (from `/proc/stat`)
- **Memory**: total, used, free, percent (from `/proc/meminfo`)
- **Load**: 1m, 5m, 15m averages (from `/proc/loadavg`)

## Retry Logic

If the server is unreachable, the collector retries with exponential backoff:
1s, 2s, 4s, 8s, ... up to 30s max. Backoff resets after successful delivery.

## systemd Service

Create `/etc/systemd/system/sysbeat-collector.service`:

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

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sysbeat-collector
sudo systemctl start sysbeat-collector
sudo journalctl -u sysbeat-collector -f
```

## Architecture Notes

- **CPU calculation**: delta-based using previous `/proc/stat` snapshot. First run returns 0% usage.
- **Memory**: uses `MemAvailable` when present (Linux 3.14+), falls back to `MemFree + Buffers + Cached`.
- **Graceful shutdown**: on SIGTERM/SIGINT finishes current send, then exits.
