# sysbeat — Architecture

Общая архитектура системы мониторинга: компоненты, потоки данных, хранилище, API и протоколы коммуникации.

---

## Компоненты

```
┌─────────────┐      HTTP POST       ┌─────────────┐      WebSocket       ┌─────────────┐
│  Collector  │ ───────────────────> │    Server   │ ───────────────────> │  Dashboard  │
│  (Linux)    │   "metrics payload"  │  (Fastify)  │   "live updates"     │  (Browser)  │
└─────────────┘                      └──────┬──────┘                      └─────────────┘
                                            │
                                            │ SQLite
                                            v
                                       ┌─────────────┐
                                       │   SQLite    │
                                       │   (WAL)     │
                                       └─────────────┘
```

### Collector

- Запускается на каждом мониторируемом Linux-устройстве
- Читает `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`
- Отправляет JSON-метрики на сервер через HTTP POST каждую секунду
- Retry с экспоненциальным backoff при недоступности сервера
- Graceful shutdown: дожидается завершения текущей отправки

### Server

- Fastify HTTP сервер с WebSocket (`@fastify/websocket`)
- SQLite (`better-sqlite3`, WAL mode) для хранения метрик
- REST API: ingest, health, devices, metrics query
- WebSocket broadcast: отправляет обновления всем подключённым dashboard'ам
- Background jobs: retention (7 дней), hourly precompute, heartbeat monitor

### Dashboard

- React 19 SPA (Vite 8, Tailwind CSS 4)
- Zustand store: 300 точек истории, список устройств, состояние соединения
- Chart.js с отключённой анимацией для real-time производительности
- WebSocket auto-reconnect с exponential backoff
- CSV export сырых данных

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
Dashboard opens ws://server/stream?deviceId=xxx
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
  ├─> currentMetric — последняя точка
  ├─> devices (IDeviceInfo[]) — список с online/offline статусом
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

### `metrics` — сырые метрики

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AI | Автоинкремент |
| `device_id` | TEXT NOT NULL | Идентификатор устройства |
| `timestamp` | INTEGER NOT NULL | UNIX timestamp в мс |
| `cpu_usage` | REAL | Загрузка CPU (%) |
| `cpu_user` | REAL | CPU user time (%) |
| `cpu_system` | REAL | CPU system time (%) |
| `cpu_idle` | REAL | CPU idle time (%) |
| `mem_percent` | REAL | Занято памяти (%) |
| `mem_total_mb` | INTEGER | Всего памяти (MB) |
| `mem_used_mb` | INTEGER | Использовано памяти (MB) |
| `mem_free_mb` | INTEGER | Свободно памяти (MB) |
| `load_1m` | REAL | Load average 1m |
| `load_5m` | REAL | Load average 5m |
| `load_15m` | REAL | Load average 15m |

**Индексы:**
- `idx_metrics_time` на `(device_id, timestamp)` — быстрая выборка по устройству и времени
- `idx_metrics_timestamp` на `(timestamp)` — быстрая очистка старых данных

### `hourly_stats` — агрегированные данные

| Column | Type | Description |
|--------|------|-------------|
| `device_id` | TEXT | Идентификатор устройства |
| `hour` | TEXT | Час в формате `YYYY-MM-DD HH:00:00` |
| `avg_cpu` | REAL | Средняя загрузка CPU |
| `max_cpu` | REAL | Максимальная загрузка CPU |
| `avg_mem` | REAL | Среднее использование памяти |
| `max_mem` | REAL | Максимальное использование памяти |
| `samples` | INTEGER | Количество точек в часе |

**PK:** `(device_id, hour)` — уникальная пара.

**Индекс:** `idx_hourly` на `(device_id, hour)`

---

## REST API

### `POST /ingest`

Принимает метрики от collector. Требует `Authorization: Bearer <INGEST_TOKEN>`.

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

**Rate limit:** 100 запросов/мин на `deviceId`.

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

```json
[
  { "deviceId": "raspberry-pi-4", "lastSeen": 1715251200000, "isOnline": true }
]
```

### `GET /api/metrics/:deviceId`

**Query params:**
- `from` — timestamp ms (default: 0)
- `to` — timestamp ms (default: now)
- `resolution` — `raw` | `hourly` | `daily` (default: `raw`)

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

### Подключение

```
ws://host:port/stream?deviceId=<deviceId>
```

### Сообщения Server → Client

| type | Поля | Когда отправляется |
|------|------|-------------------|
| `init` | `deviceId`, `metrics: IMetricPayload[]` | При подключении клиента (история из БД) |
| `update` | `deviceId`, `metric: IMetricPayload` | При каждом новом `POST /ingest` |
| `device-online` | `deviceId` | Устройство впервые прислало метрику |
| `device-offline` | `deviceId` | Устройство молчит >30 секунд |
| `aggregation` | `deviceId`, `data: IAggregationBucket[]` | Hourly stats update |

### Фильтрация на клиенте

Сервер broadcast'ит сообщения **всем** подключённым клиентам. Каждый dashboard фильтрует по `message.deviceId === selectedDevice`.

### Reconnect logic (dashboard)

- Начальная задержка: 1 сек
- Экспоненциальный рост: 1с → 2с → 4с → 8с → ... → 30с max
- Jitter: +0–200 мс случайного смещения
- Статус: `reconnecting` (жёлтый индикатор)
- При успешном подключении: сброс backoff, статус `online`

---

## Background Jobs

| Job | Файл | Период | Что делает |
|-----|------|--------|-----------|
| Retention | `store/retention.ts` | Каждый час | Удаляет метрики старше 7 дней, orphaned hourly_stats, VACUUM |
| Precompute | `store/aggregation.ts` | Каждые 10 мин | Пересчитывает `hourly_stats` за последний час |
| Heartbeat | `websocket/stream.ts` | Каждые 5 сек | Проверяет `mapLastSeen`, отправляет `device-offline` при тишине >30с |

---

## Performance Notes

- **SQLite WAL mode** — позволяет читать во время записи, критично для concurrent dashboard'ов
- **Prepared statements** — скомпилированы один раз при импорте модуля, переиспользуются
- **Chart.js:** `animation: { duration: 0 }`, `pointRadius: 0` — отключено для real-time
- **History limit:** 300 точек в Zustand (~5 минут при 1 Гц), больше — из SQLite через REST
- **WebSocket broadcast** — `setImmediate` после INSERT, чтобы HTTP-ответ не ждал broadcast

---

## Security

- **Bearer token** на `POST /ingest` — единственная точка аутентификации
- **Rate limiting** — 100 req/min per deviceId, in-memory
- **CORS** — ограничен origin dashboard'а (`CORS_ORIGIN` env)
- **Input validation** — Zod на теле запроса и query-параметрах
- **No auth на WebSocket** — фильтрация по `deviceId` происходит на клиенте (server broadcast'ит всем)

---

## Directory Layout (server)

```
src/
├── server.ts              # Entry point: Fastify init, route registration, jobs
├── config.ts              # Zod env validation, objConfig
├── routes/
│   ├── ingest.ts          # POST /ingest
│   ├── health.ts          # GET /health
│   ├── devices.ts         # GET /devices
│   └── metrics.ts         # GET /api/metrics/:deviceId
├── websocket/
│   └── stream.ts          # WS /stream, broadcast, heartbeat
└── store/
    ├── db.ts              # Singleton DB connection, migrations
    ├── metrics-store.ts   # INSERT, SELECT raw metrics
    ├── aggregation.ts     # Hourly/daily precompute
    └── retention.ts       # Cleanup old data
```
