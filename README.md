# sysbeat

Real-time Linux device monitoring system. Collect system metrics from Linux devices, stream them through a central server, and visualize live on a web dashboard.

## Overview

sysbeat consists of three components that work together:

| Component | Directory | Purpose |
|-----------|-----------|---------|
| **Server** | `server/` | Fastify HTTP + WebSocket server, SQLite storage, REST API |
| **Collector** | `collector/` | Node.js agent that reads `/proc` and sends metrics to the server |
| **Dashboard** | `dashboard/` | React SPA that visualizes live metrics in real-time |

```
┌──────────────────┐      HTTP POST       ┌──────────────┐      WebSocket       ┌──────────────────┐
│    Collector     │ ──────────────────▶  │    Server    │ ──────────────────▶  │    Dashboard     │
│  Linux /proc     │      /ingest         │  Fastify +   │      /stream         │  React SPA       │
│  parser          │                      │  SQLite      │                      │  + Chart.js      │
└──────────────────┘                      └──────────────┘                      └──────────────────┘
```

## Quick Start (Development)

### Automated setup

```bash
./setup.sh
```

This generates random `INGEST_TOKEN` and `DASHBOARD_TOKEN`, creates all `.env`/`.env.local` files, and installs dependencies.

For production: `sudo ./setup.sh --prod --install-systemd --install-nginx`.

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Linux host for running the collector

### 1. Server

```bash
cd server
cp .env.example .env
# Edit .env: set INGEST_TOKEN and DASHBOARD_TOKEN
pnpm install
pnpm run dev
```

Server starts on `http://localhost:3000`.

### 2. Collector

```bash
cd collector
cp .env.example .env
# Edit .env: set SERVER_URL, INGEST_TOKEN, DEVICE_ID
pnpm install
pnpm run dev
```

### 3. Dashboard

```bash
cd dashboard
cp .env.example .env.local
# Edit .env.local: set VITE_API_URL, VITE_WS_URL, VITE_INGEST_TOKEN
pnpm install
pnpm run dev
```

Dashboard opens at `http://localhost:5173`.

## Project Structure

```
sysbeat/
├── server/
│   ├── src/
│   │   ├── server.ts           # Entry point
│   │   ├── config.ts           # Environment validation
│   │   ├── routes/             # HTTP routes (auth, ingest, health, devices, metrics)
│   │   ├── websocket/          # WebSocket streaming
│   │   ├── store/              # SQLite data layer
│   │   └── types/
│   ├── data/                   # SQLite database files (gitignored)
│   └── .env.example
├── collector/
│   ├── src/
│   │   ├── index.ts            # Main loop
│   │   ├── parser.ts           # /proc parser
│   │   ├── sender.ts           # HTTP sender with retry
│   │   └── config.ts
│   └── .env.example
├── dashboard/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── config.ts           # Environment validation
│   │   ├── stores/dashboard.ts # Zustand store
│   │   ├── hooks/              # useWebSocket, useMetrics
│   │   ├── components/         # Charts, cards, tables
│   │   └── lib/api.ts          # API helpers
│   └── .env.example
├── nginx/
│   └── sysbeat.conf            # nginx reverse proxy config
├── setup.sh                    # Automated setup script
├── README.md                   # This file
├── SETUP_GUIDE.md              # Detailed deployment guide
└── ARCHITECTURE.md             # System architecture & data flow
```

## Documentation

| Document | Description |
|----------|-------------|
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | Step-by-step deployment for development and production |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data flow, database schema, API reference |
| [server/WEBSOCKET_GUIDE.md](server/WEBSOCKET_GUIDE.md) | Deep dive into WebSocket protocol and broadcast mechanics |
| [collector/COLLECTOR_GUIDE.md](collector/COLLECTOR_GUIDE.md) | How the collector parses `/proc`, sends data, and handles retry |
| [server/README.md](server/README.md) | Server-specific README |
| [collector/README.md](collector/README.md) | Collector-specific README |
| [dashboard/README.md](dashboard/README.md) | Dashboard-specific README |

## Stack

- **Server**: Fastify, `@fastify/websocket`, `better-sqlite3`, TypeScript, Zod, pino
- **Collector**: Node.js built-ins only (`fs`, `http`, `https`), TypeScript
- **Dashboard**: Vite 8, React 19, TypeScript, Tailwind CSS 4, Chart.js, Zustand, TanStack Query

## License

MIT
