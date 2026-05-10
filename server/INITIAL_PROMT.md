# Промт: sysbeat server

Создай серверную часть проекта `sysbeat` — real-time dashboard для мониторинга Linux-устройств.

## Что делает сервер

1. Принимает HTTP POST с метриками от collector'а (Node.js скрипт на Linux-устройстве)
2. Хранит данные в **SQLite** (better-sqlite3), retention 7 дней
3. Предоставляет агрегированные запросы (raw, hourly, daily)
4. Broadcast'ит обновления всем подключённым клиентам через WebSocket
5. Отдаёт исторические данные при подключении нового клиента

## API

```
POST /ingest          # от collector'а, body: IMetricPayload
GET  /health          # healthcheck + db stats
GET  /devices         # список активных устройств
GET  /api/metrics/:deviceId?from=&to=&resolution=raw|hourly|daily
WS   /stream          # для dashboard клиентов
```

## Формат данных

```typescript
interface IMetricPayload {
  deviceId: string;      // "raspberry-pi-4", "homelab-nuc"
  timestamp: number;       // unix ms
  cpu: {
    usage: number;         // 0-100
    user: number;
    system: number;
    idle: number;
  };
  memory: {
    total: number;         // MB
    used: number;
    free: number;
    percent: number;       // 0-100
  };
  load: [number, number, number]; // 1m, 5m, 15m
}
```

## WebSocket сообщения

```typescript
{type: 'init', deviceId: string, metrics: IMetricPayload[]}     // при подключении
{type: 'update', deviceId: string, metric: IMetricPayload}       // каждая новая точка
{type: 'device-online', deviceId: string}                        // первый heartbeat
{type: 'device-offline', deviceId: string}                       // нет данных 30 сек
{type: 'aggregation', deviceId: string, data: Aggregation[]}    // hourly update
```

## SQLite Schema

```sql
-- Миграция при старте
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  cpu_usage REAL,
  cpu_user REAL,
  cpu_system REAL,
  mem_percent REAL,
  mem_used_mb INTEGER,
  load_1m REAL,
  load_5m REAL,
  load_15m REAL
);

CREATE INDEX IF NOT EXISTS idx_metrics_time 
  ON metrics(device_id, timestamp);

-- Предсчитанные агрегации
CREATE TABLE IF NOT EXISTS hourly_stats (
  device_id TEXT,
  hour TEXT,  -- "2025-01-15T14:00"
  avg_cpu REAL,
  max_cpu REAL,
  avg_mem REAL,
  max_mem REAL,
  samples INTEGER,
  PRIMARY KEY (device_id, hour)
);

CREATE INDEX IF NOT EXISTS idx_hourly ON hourly_stats(device_id, hour);
```

## Агрегация SQL (hourly на лету)

```sql
SELECT 
  strftime('%Y-%m-%dT%H:00', timestamp, 'unixepoch') as bucket,
  ROUND(AVG(cpu_usage), 1) as avg_cpu,
  ROUND(MAX(cpu_usage), 1) as max_cpu,
  ROUND(AVG(mem_percent), 1) as avg_mem,
  COUNT(*) as samples
FROM metrics
WHERE device_id = ? AND timestamp BETWEEN ? AND ?
GROUP BY bucket
ORDER BY bucket;
```

## Retention

- Автоудаление старше 7 дней: `DELETE FROM metrics WHERE timestamp < strftime('%s', 'now', '-7 days')`
- Запуск раз в час через `setInterval`
- Также чистить orphaned hourly_stats

## Требования

- **Fastify** вместо Express
- **@fastify/websocket** для WS
- **better-sqlite3** для SQLite (synchronous, быстрее для read-heavy)
- **TypeScript**, strict mode
- Graceful shutdown (close db, close ws clients)
- CORS настроен для фронтенда
- Логирование через pino
- Конфиг через .env

## Дополнительно

- Защита POST /ingest Bearer token (`INGEST_TOKEN`)
- Rate limiting на ingest (100 req/min на deviceId)
- Фоновый precompute hourly_stats каждые 10 минут
- Health endpoint возвращает: uptime, db size, device count, last ingest timestamp
- naming переменных проета - Hungarain notation

## Структура проекта

```
server/
├── src/
│   ├── server.ts              # точка входа
│   ├── config.ts              # env + defaults
│   ├── routes/
│   │   ├── ingest.ts
│   │   ├── health.ts
│   │   └── devices.ts
│   ├── websocket/
│   │   └── stream.ts
│   ├── store/
│   │   ├── db.ts              # connection + миграции
│   │   ├── metrics-store.ts   # insert + query raw
│   │   ├── aggregation.ts     # hourly/daily функции
│   │   └── retention.ts       # автоочистка
│   └── types/
│       └── index.ts
├── data/                      # .gitignore, SQLite файл здесь
├── .env.example
├── tsconfig.json
├── package.json
└── README.md                   # как запустить, API docs
```

## Ожидания

- Продакшн-качество код
- Комментарии где логика нетривиальна
- `pnpm run dev` через tsx + nodemon
- Тесты не нужны, но структура тестируемая

Начни с создания всех файлов.
