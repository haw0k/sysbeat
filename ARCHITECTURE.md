# sysbeat — Architecture

System architecture: components, data flows, storage, APIs, and communication protocols.

---

## Components

```
+-------------+      HTTP POST       +-------------+      WebSocket       +-------------+
|  Collector  | -------------------> |    Server   | -------------------> |  Dashboard  |
|  (Linux)    |   "metrics payload"  |  (Fastify)  |   "live updates"     |  (Browser)  |
+-------------+                      +------+------+                      +-------------+
                                            |
                                            | SQLite
                                            v
                                       +-------------+
                                       |   SQLite    |
                                       |   (WAL)     |
                                       +-------------+
```

### Collector

- Runs on each monitored Linux device
- Reads `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`
- Sends JSON metrics to the server via HTTP POST every second
- Retries with exponential backoff when the server is unreachable
- Graceful shutdown: waits for the current send to finish

### Server

- Fastify HTTP server with WebSocket (`@fastify/websocket`)
- SQLite (`better-sqlite3`, WAL mode, incremental_vacuum) for metric storage
- REST API: ingest, health, devices, metrics query
- WebSocket broadcast: sends updates to all connected dashboards (auth required)
- Dual-token auth: `INGEST_TOKEN` for collectors (write), `DASHBOARD_TOKEN` for dashboard (read)
- Background jobs: retention (7 days), hourly precompute, heartbeat monitor

### Dashboard

- React 19 SPA (Vite 8, Tailwind CSS 4)
- Zustand store: 300 points of history, device list, connection state
- Chart.js with animation disabled for real-time performance
- WebSocket auto-reconnect with exponential backoff
- CSV export of raw data

---

## Data Flow

### 1. Collector → Server

```
Collector (index.ts)
  │ setInterval(1000ms)
  │
  ├─> parseCpu(/proc/stat)        → { usage, user, system, idle }
  ├─> parseMemory(/proc/meminfo)  → { total, used, free, percent }
  ├─> parseLoad(/proc/loadavg)    → [1m, 5m, 15m]
  │
  └─> sendMetrics(payload)
       │ HTTP POST /ingest
       │ Authorization: Bearer <token>
       v
  Server (ingest route)
       │
       ├─> Zod validation
       ├─> Rate limit check (100 req/min per deviceId)
       ├─> markDeviceSeen(deviceId)
       │     └── if new device → broadcastDeviceOnline()
       ├─> insertMetric() → SQLite
       └─> setImmediate(() => broadcastUpdate(metric))
```

### 2. Server → Dashboard

```
Dashboard opens ws://server/stream?deviceId=xxx&token=yyy
  │  (token from VITE_INGEST_TOKEN, set to DASHBOARD_TOKEN in production)
  │
  └─> Server sends init burst (last 100 raw metrics from DB)
       │
       │<── WebSocket: { type: "init", deviceId, metrics: [...] }
       │
       │<── WebSocket: { type: "update", deviceId, metric: {...} }
       │    (on every new POST /ingest)
       │
       │<── WebSocket: { type: "device-online", deviceId }
       │<── WebSocket: { type: "device-offline", deviceId }
       │    (heartbeat monitor, 30s threshold)
```

### 3. Dashboard internal flow

```
WebSocket message
  │
  ├─> type: "init"     → setInitMetrics(metrics) → history = metrics
  ├─> type: "update"   → pushMetric(metric)        → history.push(metric), trim to 300
  ├─> type: "aggregation"→ setHourly(data)           → hourly = data
  ├─> type: "device-online"  → markDeviceOnline()
  └─> type: "device-offline" → markDeviceOffline()

Zustand store
  │
  ├─> history (IMetricPayload[]) — last 300 points
  ├─> currentMetric — latest point
  ├─> devices (IDeviceInfo[]) — list with online/offline status
  ├─> hourly (IAggregationBucket[]) — hourly stats
  └─> connectionStatus — online / offline / reconnecting

React components
  │
  ├─> CpuChart      → history.map(m => m.cpu)
  ├─> MemoryChart   → history.map(m => m.memory)
  ├─> LoadChart     → history.map(m => m.load)
  ├─> RawDataTable  → history.slice(-10)
  └─> MetricCard    → currentMetric + sparkline from history
```

---

## Database Schema

### `metrics` — raw metrics

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AI | Autoincrement |
| `device_id` | TEXT NOT NULL | Device identifier |
| `timestamp` | INTEGER NOT NULL | UNIX timestamp in ms |
| `cpu_usage` | REAL | CPU load (%) |
| `cpu_user` | REAL | CPU user time (%) |
| `cpu_system` | REAL | CPU system time (%) |
| `cpu_idle` | REAL | CPU idle time (%) |
| `mem_percent` | REAL | Memory used (%) |
| `mem_total_mb` | INTEGER | Total memory (MB) |
| `mem_used_mb` | INTEGER | Used memory (MB) |
| `mem_free_mb` | INTEGER | Free memory (MB) |
| `load_1m` | REAL | Load average 1m |
| `load_5m` | REAL | Load average 5m |
| `load_15m` | REAL | Load average 15m |

**Indexes:**
- `idx_metrics_time` on `(device_id, timestamp)` — fast lookup by device and time
- `idx_metrics_timestamp` on `(timestamp)` — fast cleanup of old data

### `hourly_stats` — aggregated data

| Column | Type | Description |
|--------|------|-------------|
| `device_id` | TEXT | Device identifier |
| `hour` | TEXT | Hour in format `YYYY-MM-DD HH:00:00` |
| `avg_cpu` | REAL | Average CPU load |
| `max_cpu` | REAL | Maximum CPU load |
| `avg_mem` | REAL | Average memory usage |
| `max_mem` | REAL | Maximum memory usage |
| `samples` | INTEGER | Number of points in the hour |

**PK:** `(device_id, hour)` — unique pair.

**Index:** `idx_hourly` on `(device_id, hour)`

---

## REST API

### `POST /ingest`

Accepts metrics from the collector. Requires `Authorization: Bearer <INGEST_TOKEN>`.

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

**Rate limit:** 100 requests/min per `deviceId`.

### `GET /health`

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

Requires `Authorization: Bearer <INGEST_TOKEN or DASHBOARD_TOKEN>`.

```json
[
  { "deviceId": "raspberry-pi-4", "lastSeen": 1715251200000, "isOnline": true }
]
```

### `GET /api/metrics/:deviceId`

Requires `Authorization: Bearer <INGEST_TOKEN or DASHBOARD_TOKEN>`.

**Query params:**
- `from` — timestamp ms (default: 0)
- `to` — timestamp ms (default: now)
- `resolution` — `raw` | `hourly` | `daily` (default: `raw`)
- `limit` — max rows for raw resolution (default: 10000)

**Response (raw):**
```json
{
  "deviceId": "raspberry-pi-4",
  "resolution": "raw",
  "data": [
    { "timestamp": 1715251200000, "cpu": {...}, "memory": {...}, "load": [...] }
  ]
}
```

---

## WebSocket Protocol

### Connection

```
ws://host:port/stream?deviceId=<deviceId>&token=<DASHBOARD_TOKEN>
```

WebSocket connections require authentication via query parameter `?token=` or `Authorization: Bearer` header. The server uses `preHandler: authenticate` which accepts both `INGEST_TOKEN` and `DASHBOARD_TOKEN`.

### Server → Client messages

| type | Fields | When sent |
|------|--------|-----------|
| `init` | `deviceId`, `metrics: IMetricPayload[]` | On client connect (history from DB) |
| `update` | `deviceId`, `metric: IMetricPayload` | On every new `POST /ingest` |
| `device-online` | `deviceId` | Device sent its first heartbeat |
| `device-offline` | `deviceId` | Device silent for >30 seconds |
| `aggregation` | `deviceId`, `data: IAggregationBucket[]` | Hourly stats update |

### Client-side filtering

The server broadcasts messages to **all** connected clients. Each dashboard filters by `message.deviceId === selectedDevice`.

### Reconnect logic (dashboard)

- Initial delay: 1 second
- Exponential growth: 1s → 2s → 4s → 8s → ... → 30s max
- Jitter: +0–200 ms random offset
- Status: `reconnecting` (yellow indicator)
- On successful connect: reset backoff, status `online`

---

## Background Jobs

| Job | File | Period | What it does |
|-----|------|--------|--------------|
| Retention | `store/retention.ts` | Every hour | Deletes metrics older than 7 days, orphaned hourly_stats, incremental_vacuum if >1000 rows deleted |
| Precompute | `store/aggregation.ts` | Every 10 minutes | Recalculates `hourly_stats` for the last hour |
| Heartbeat | `websocket/stream.ts` | Every 5 seconds | Checks `setOnlineDevices` against `mapLastSeen`, sends `device-offline` if silent >30s |

---

## Performance Notes

- **SQLite WAL mode** — allows reading during writes, critical for concurrent dashboards
- **Prepared statements** — compiled once at module load, reused
- **Chart.js:** `animation: { duration: 0 }`, `pointRadius: 0` — disabled for real-time
- **History limit:** 300 points in Zustand (~5 minutes at 1 Hz), more from SQLite via REST
- **WebSocket broadcast** — `setImmediate` after INSERT so the HTTP response does not wait for broadcast

---

## Security

- **Dual-token auth** — `INGEST_TOKEN` for collector writes (`POST /ingest`), `DASHBOARD_TOKEN` for dashboard reads (`GET /devices`, `/api/metrics`, WS `/stream`). Dashboard token is not privileged for writes.
- **Rate limiting** — 100 req/min per deviceId, in-memory
- **CORS** — restricted to dashboard origin (`CORS_ORIGIN` env)
- **Input validation** — Zod on request body and query params
- **WebSocket auth** — `preHandler: authenticate` on `/stream`, token passed as `?token=` query parameter. Unauthorized connections receive HTTP 401 before upgrade.

---

## Directory Layout (server)

```
src/
├── server.ts              # Entry point: Fastify init, route registration, jobs
├── config.ts              # Zod env validation, objConfig
├── routes/
│   ├── auth.ts            # Dual-token auth: authenticate, authenticateIngest
│   ├── ingest.ts          # POST /ingest
│   ├── health.ts          # GET /health
│   ├── devices.ts         # GET /devices
│   └── metrics.ts         # GET /api/metrics/:deviceId
├── websocket/
│   └── stream.ts          # WS /stream, broadcast, heartbeat
├── types/
│   └── index.ts           # Shared types and interfaces
└── store/
    ├── db.ts              # Singleton DB connection, migrations
    ├── metrics-store.ts   # INSERT, SELECT raw metrics
    ├── aggregation.ts     # Hourly/daily precompute
    └── retention.ts       # Cleanup old data
```
