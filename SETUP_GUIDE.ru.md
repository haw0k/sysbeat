# sysbeat — Setup Guide

Пошаговая инструкция по развёртыванию системы мониторинга sysbeat. Покрывает development-окружение и production-деплой.

---

## Содержание

1. [Development (локальная разработка)](#development)
2. [Production (сервер + systemd)](#production)
3. [Reverse Proxy (nginx)](#reverse-proxy)
4. [Troubleshooting](#troubleshooting)

---

## Development

### Требования

- Node.js >= 20
- pnpm >= 9
- Linux или WSL (для запуска collector)

### Шаг 1. Клонирование и установка

```bash
git clone <repo-url> sysbeat
cd sysbeat
```

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
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

**Обязательно** измените `INGEST_TOKEN` на случайную строку.

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
```

Запуск:

```bash
pnpm run dev
```

Откроется `http://localhost:5173`. Выберите устройство в селекторе — графики оживут.

### Разработка в WSL + браузер на Windows

Если сервер и collector запущены в WSL, а браузер — на Windows, `localhost` в Windows и WSL — разные хосты. Используйте WSL IP:

```bash
# Узнайте IP WSL
hostname -I | awk '{print $1}'
# Пример: 172.31.199.36
```

1. **Server**: запустите с `CORS_ORIGIN`, указывающим на WSL IP dashboard:
   ```bash
   cd server
   CORS_ORIGIN=http://172.31.199.36:5173 pnpm run dev
   ```

2. **Dashboard**: в `.env.local` используйте WSL IP вместо `localhost`:
   ```
   VITE_API_URL=http://172.31.199.36:3000
   VITE_WS_URL=ws://172.31.199.36:3000
   ```

3. **Dashboard**: запустите с `--host`, чтобы Vite был доступен извне WSL:
   ```bash
   cd dashboard
   npx vite dev --host 0.0.0.0
   ```

4. **Браузер Windows**: откройте `http://172.31.199.36:5173/`

### Проверка работоспособности

```bash
# Проверка health endpoint
curl http://localhost:3000/health

# Проверка списка устройств
curl http://localhost:3000/devices

# Проверка метрик устройства
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

Рекомендуется запускать через systemd или Docker.

### systemd service для Server

Создайте `/etc/systemd/system/sysbeat-server.service`:

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

systemd service уже описан в `collector/README.md`. Кратко:

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

Результат в `dist/`. Раздайте через nginx, Caddy или любой static file server.

```nginx
server {
    listen 443 ssl;
    server_name sysbeat.example.com;

    root /opt/sysbeat/dashboard/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API и WebSocket к серверу
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

> **Важно**: в production dashboard должен обращаться к серверу по тому же origin (чтобы избежать CORS-проблем), либо сервер должен иметь `CORS_ORIGIN` с правильным доменом.

---

## Reverse Proxy

### nginx (рекомендуется)

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

### Caddy (простая альтернатива)

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

### "No devices connected" в dashboard

1. Проверьте, что collector запущен и логи показывают `status: 200`.
2. Проверьте `SERVER_URL` и `INGEST_TOKEN` в collector — они должны совпадать с сервером.
3. Проверьте `curl http://localhost:3000/devices` — должен вернуть список.

### Dashboard не подключается к WebSocket

1. Проверьте `VITE_WS_URL` — должен быть `ws://localhost:3000` (или `wss://` для HTTPS).
2. Проверьте CORS: сервер должен разрешать origin dashboard (`CORS_ORIGIN=http://localhost:5173`).
3. Проверьте DevTools → Network → WS — есть ли попытка соединения?
4. Если за nginx: убедитесь, что `/stream` проксирует WebSocket (`Upgrade`, `Connection: upgrade`).

### CORS ошибки в WSL + Windows браузер

**Причина**: `localhost` в Windows и WSL — разные сетевые интерфейсы. Браузер шлёт `Origin: http://localhost:5173`, а сервер в WSL видит его как `127.0.0.1` и CORS не совпадает.

**Решение**:
1. Используйте WSL IP вместо `localhost` во всех конфигах:
   - `CORS_ORIGIN=http://172.31.199.36:5173` (server `.env`)
   - `VITE_API_URL=http://172.31.199.36:3000` (dashboard `.env.local`)
   - `VITE_WS_URL=ws://172.31.199.36:3000` (dashboard `.env.local`)
2. Запускайте dashboard с `--host 0.0.0.0`, чтобы он слушал не только `127.0.0.1`.
3. В Windows-браузере открывайте `http://<WSL_IP>:5173/`.

### "Database is locked" или "SQLITE_BUSY"

- Убедитесь, что сервер запущен в одном экземпляре (не два процесса на одну БД).
- Проверьте, что `journal_mode = WAL` включён (в `db.ts` это по умолчанию).

### Collector падает с ошибкой парсинга

- Убедитесь, что запускаете на Linux (или WSL). `/proc` доступен только на Linux.
- Проверьте права на чтение `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`.

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
