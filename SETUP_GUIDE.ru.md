# sysbeat — Setup Guide

Пошаговая инструкция по развёртыванию системы мониторинга sysbeat. Покрывает development-окружение и production-деплой.

---

## Содержание

1. [Development (локальная разработка)](#development)
2. [Production (сервер + systemd)](#production)
3. [Troubleshooting](#troubleshooting)

---

## Development

### Требования

- Node.js >= 20
- pnpm >= 9
- Linux (для запуска collector)

### Шаг 1. Клонирование и установка

```bash
git clone <repo-url> sysbeat
cd sysbeat
```

#### Автоматическая установка

```bash
./setup.sh
```

Одна команда генерирует случайный `INGEST_TOKEN`, создаёт все файлы `.env` и `.env.local`, и устанавливает зависимости. Дальше переходите к шагу 5 для запуска сервисов.

Для production: `./setup.sh --prod` (собирает и деплоит в `/opt/sysbeat`). С nginx: `sudo ./setup.sh --prod --install-nginx`. Полная установка: `sudo ./setup.sh --prod --install-systemd --install-nginx`.

#### Ручная установка

Установите зависимости для всех трёх частей:

```bash
cd server && pnpm install
cd ../collector && pnpm install
cd ../dashboard && pnpm install
```

### Шаг 2. Настройка Server

```bash
cd server
cp .env.example .env
```

Отредактируйте `.env`:

```
PORT=3000
DB_PATH=./data/sysbeat.db
INGEST_TOKEN=change-me-in-production
DASHBOARD_TOKEN=change-me-in-production
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

**Обязательно** измените `INGEST_TOKEN` на случайную строку. Сгенерируйте командой:

```bash
openssl rand -hex 32
```

Запуск:

```bash
pnpm run dev
```

Сервер запустится на `http://localhost:3000`.

### Шаг 3. Настройка Collector

```bash
cd collector
cp .env.example .env
```

Отредактируйте `.env`:

```
SERVER_URL=http://localhost:3000/ingest
INGEST_TOKEN=change-me-in-production   # тот же токен, что в сервере
DEVICE_ID=linux-device-1
INTERVAL_MS=1000
```

Запуск:

```bash
pnpm run dev
```

Коллектор начнёт читать `/proc` и отправлять метрики каждую секунду.

### Шаг 4. Настройка Dashboard

```bash
cd dashboard
cp .env.example .env.local
```

Отредактируйте `.env.local`:

```
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
VITE_INGEST_TOKEN=change-me-in-production   # тот же токен, что в сервере
```

Запуск:

```bash
pnpm run dev
```

Откроется `http://localhost:5173`. Выберите устройство в селекторе — графики оживут.

### Проверка работоспособности

```bash
INGEST_TOKEN="change-me-in-production"
DASHBOARD_TOKEN="change-me-in-production"

# Проверка health endpoint (без аутентификации)
curl http://localhost:3000/health

# Отправка метрики (требует INGEST_TOKEN)
curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","timestamp":'$(date +%s%3N)',"cpu":{"usage":10,"user":5,"system":3,"idle":82},"memory":{"total":8192,"used":4096,"free":4096,"percent":50},"load":[0.5,0.4,0.3]}' \
  http://localhost:3000/ingest

# Проверка списка устройств (требует INGEST_TOKEN или DASHBOARD_TOKEN)
curl -H "Authorization: Bearer $DASHBOARD_TOKEN" http://localhost:3000/devices

# Проверка метрик устройства (требует INGEST_TOKEN или DASHBOARD_TOKEN)
curl -H "Authorization: Bearer $DASHBOARD_TOKEN" "http://localhost:3000/api/metrics/linux-device-1?resolution=raw"
```

---

## Production

### Автоматический деплой

```bash
# Полная production установка (сборка + деплой + systemd + nginx)
sudo ./setup.sh --prod --install-systemd --install-nginx
```

Одна команда:
1. Генерирует случайный `INGEST_TOKEN`
2. Создаёт все `.env` / `.env.local` файлы с production настройками
3. Устанавливает зависимости и собирает все три компонента
4. Копирует собранные файлы в `/opt/sysbeat/`
5. Устанавливает systemd-сервисы (`sysbeat-server`, `sysbeat-collector`) и запускает их
6. Устанавливает nginx, настраивает его для раздачи dashboard и проксирования API/WebSocket

После установки откройте `http://<server-ip>` в браузере.

Флаги:
| Флаг | Назначение |
|------|------------|
| `--prod` | Собрать все компоненты, задеплоить в `/opt/sysbeat` |
| `--install-systemd` | Установить systemd-сервисы (подразумевает `--prod`) |
| `--install-nginx` | Установить и настроить nginx |
| `--device-id <id>` | ID устройства для collector (по умолчанию: hostname) |

### Как это работает

```
браузер (http://server-ip:80)
       │
       v
      nginx (port 80)
       │        │
       │        └── /api/*, /devices, /health, /ingest, /stream → proxy → server:3000
       │
       └── /* → статические файлы /opt/sysbeat/dashboard/dist/
```

В production dashboard использует пустые `VITE_API_URL` и `VITE_WS_URL` (same-origin). Все запросы идут через nginx, который проксирует API/WebSocket на сервер на порту 3000.

### Ручная установка (без setup.sh)

Соберите каждый компонент:

```bash
cd server && pnpm run build
cd ../collector && pnpm run build
cd ../dashboard && pnpm run build
```

Скопируйте в `/opt/sysbeat/` и настройте nginx/systemd вручную. См. `nginx/sysbeat.conf` для эталонной конфигурации nginx.

### Конфигурация nginx

Скрипт установки использует `nginx/sysbeat.conf`. Ключевые моменты:
- Статические файлы dashboard отдаются из `/opt/sysbeat/dashboard/dist/`
- API-маршруты (`/api/`, `/devices`, `/health`, `/ingest`) проксируются на `127.0.0.1:3000`
- WebSocket (`/stream`) проксируется с заголовками `Upgrade` и `Connection: upgrade`

---

## Environment Variables Reference

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | — | `3000` | HTTP server port |
| `DB_PATH` | — | `./data/sysbeat.db` | SQLite file path |
| `INGEST_TOKEN` | **yes** | — | Bearer token для записи collector (POST /ingest) |
| `DASHBOARD_TOKEN` | **yes** | — | Bearer token для чтения dashboard (GET endpoints, WS) |
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
| `VITE_API_URL` | — | `""` | REST API base URL (пусто = same-origin, для режима nginx proxy) |
| `VITE_WS_URL` | — | `""` | WebSocket base URL (пусто = same-origin) |
| `VITE_INGEST_TOKEN` | **yes** | — | Bearer token (равен серверному `DASHBOARD_TOKEN`) |

---

## Troubleshooting

### "No devices connected" в dashboard

1. Проверьте, что collector запущен и логи показывают `status: 200`.
2. Проверьте `SERVER_URL` и `INGEST_TOKEN` в collector — они должны совпадать с серверным `INGEST_TOKEN`.
3. Проверьте `curl -H "Authorization: Bearer $DASHBOARD_TOKEN" http://localhost:3000/devices` — должен вернуть список.
4. Убедитесь, что dashboard использует `DASHBOARD_TOKEN` (не `INGEST_TOKEN`) в `VITE_INGEST_TOKEN`.

### Dashboard не подключается к WebSocket

1. Проверьте `VITE_WS_URL` — в development должен быть `ws://localhost:3000`, в production пустой (same-origin, если за nginx).
2. Проверьте `VITE_INGEST_TOKEN` — должен быть равен серверному `DASHBOARD_TOKEN` (не `INGEST_TOKEN`). Токен передаётся как query-параметр `?token=...` для WebSocket-аутентификации.
3. Проверьте DevTools → Network → WS — URL соединения должен содержать `?token=...`. Без него сервер возвращает 401.
4. Если за nginx: убедитесь, что `/stream` проксирует WebSocket (`Upgrade`, `Connection: upgrade`).

### "Database is locked" или "SQLITE_BUSY"

- Убедитесь, что сервер запущен в одном экземпляре (не два процесса на одну БД).
- Проверьте, что `journal_mode = WAL` включён (в `db.ts` это по умолчанию).

### Collector падает с ошибкой парсинга

- Убедитесь, что запускаете на Linux . `/proc` доступен только на Linux.
- Проверьте права на чтение `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`.

### Нативный модуль better-sqlite3 не найден

**Симптомы:** `Error: Could not locate the bindings file. Tried: .../better_sqlite3.node`

**Причина:** `better-sqlite3` — нативный C++ модуль, который должен быть скомпилирован под вашу версию Node.js. Это происходит при:
- Смене версии Node.js (например, с 20 на 22).
- Родительский `pnpm-workspace.yaml` отключает сборку `better-sqlite3`.

**Исправление:**
```bash
# 1. Убедитесь, что установлены сборочные инструменты
sudo apt install build-essential python3

# 2. server/package.json уже содержит "pnpm.onlyBuiltDependencies"
#    для разрешения сборки better-sqlite3. Если у вас есть глобальный
#    ~/pnpm-workspace.yaml, эта настройка переопределяет его.
#    Если проблема сохраняется, проверьте глобальную конфигурацию workspace.

# 3. Пересоберите нативный модуль
cd server
pnpm rebuild better-sqlite3
# Если rebuild не помог, переустановите с нуля:
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Сборка dashboard падает

```bash
cd dashboard
rm -rf node_modules dist
pnpm install
pnpm run build
```

---

## Обновление системы

### Обновление зависимостей

```bash
cd server && pnpm update
cd ../collector && pnpm update
cd ../dashboard && pnpm update
```

### Пересборка

```bash
cd server && pnpm run build
cd ../collector && pnpm run build
cd ../dashboard && pnpm run build
```

### Перезапуск сервисов

```bash
sudo systemctl restart sysbeat-server
sudo systemctl restart sysbeat-collector
```

> Для dashboard достаточно пересобрать `pnpm run build` — static files обновляются мгновенно.
