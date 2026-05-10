# sysbeat dashboard

Real-time Linux device monitoring dashboard for the sysbeat project.

Built with Vite 8 + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + Chart.js + Zustand + TanStack Query.

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Edit `.env.local`:

```
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

## Run

```bash
pnpm run dev
```

Opens at `http://localhost:5173`.

## Build

```bash
pnpm run build
```

Output goes to `dist/`.

## Server requirements

The sysbeat server must be running with CORS configured for the dashboard origin:

```bash
CORS_ORIGIN=http://localhost:5173 npm run dev
```

### WSL + Windows browser

If the server runs in WSL and the browser is on Windows, use the WSL IP instead of `localhost`:

```bash
# In WSL
hostname -I | awk '{print $1}'
# Example: 172.31.199.36

# Server
CORS_ORIGIN=http://172.31.199.36:5173 pnpm run dev

# Dashboard .env.local
VITE_API_URL=http://172.31.199.36:3000
VITE_WS_URL=ws://172.31.199.36:3000

# Dashboard — bind to all interfaces
npx vite dev --host 0.0.0.0
```

Open `http://<WSL_IP>:5173/` in the Windows browser.

## Architecture

- **WebSocket** (`useWebSocket.ts`) — connects to `/stream?deviceId=...`, auto-reconnects with exponential backoff
- **Zustand store** (`stores/dashboard.ts`) — holds live metrics history (300 points), device list, connection state
- **React Query** (`useMetrics.ts`) — fetches devices and hourly aggregations, REST fallback when WS unavailable
- **Charts** (`CpuChart`, `MemoryChart`, `LoadChart`) — Chart.js with dark theme, animation disabled for real-time performance
