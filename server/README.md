# sysbeat-server

Real-time Linux device monitoring server for the sysbeat dashboard.

## Stack

- **Fastify** — HTTP server
- **@fastify/websocket** — WebSocket support
- **better-sqlite3** — SQLite (synchronous, read-heavy optimized)
- **TypeScript** — strict mode
- **pino** — logging
- **zod** — env & request validation

## Setup

```bash
cp .env.example .env
# Edit .env and set INGEST_TOKEN
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
| PORT          | 3000                    | HTTP server port                         |
| DB_PATH       | ./data/sysbeat.db       | SQLite database file path                |
| INGEST_TOKEN  | —                       | Bearer token required for POST /ingest   |
| CORS_ORIGIN   | *                       | Allowed CORS origin for frontend         |
| NODE_ENV      | development             | Runtime environment                      |

## API

### `POST /ingest`

Accepts metrics from collectors. Requires `Authorization: Bearer <INGEST_TOKEN>`.

**Body:**

```json
{
  "deviceId": "raspberry-pi-4",
  "timestamp": 1715251200000,
  "cpu": { "usage": 12.5, "user": 8.0, "system": 4.5, "idle": 87.5 },
  "memory": { "total": 8192, "used": 4096, "free": 4096, "percent": 50.0 },
  "load": [0.5, 0.4, 0.3]
}
```

Rate limit: 100 requests per minute per `deviceId`.

### `GET /health`

Returns server health and database stats.

```json
{
  "status": "ok",
  "uptime": 3600,
  "dbSizeBytes": 1048576,
  "deviceCount": 3,
  "lastIngestTimestamp": 1715251200000
}
```

### `GET /devices`

Lists all known devices with online/offline status (30-second threshold).

```json
[
  { "deviceId": "raspberry-pi-4", "lastSeen": 1715251200000, "isOnline": true }
]
```

### `GET /api/metrics/:deviceId`

Query historical metrics.

**Query params:**

- `from` — timestamp ms (default: 0)
- `to` — timestamp ms (default: now)
- `resolution` — `raw` | `hourly` | `daily` (default: `raw`)

## WebSocket

Connect to `ws://localhost:3000/stream?deviceId=xxx`.

### Server → Client messages

| type               | description                                          |
|--------------------|------------------------------------------------------|
| `init`             | Burst of last 100 raw metrics on connect             |
| `update`           | New metric point as it arrives                        |
| `device-online`    | Device sent its first heartbeat                       |
| `device-offline`   | Device silent for >30s                               |
| `aggregation`      | Hourly aggregation update (reserved for future use)   |

## Architecture Notes

- **Retention:** Old metrics are purged automatically every hour (7-day retention).
- **Precompute:** Hourly stats are recalculated every 10 minutes to keep aggregation fast.
- **Graceful shutdown:** SIGINT/SIGTERM closes DB, WebSocket clients, and background jobs.
