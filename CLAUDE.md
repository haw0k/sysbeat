# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the `server/` directory:

- `pnpm run dev` — Start development server (tsx + nodemon, hot reload)
- `pnpm run build` — Compile TypeScript to `dist/`
- `pnpm start` — Run compiled production build (`node dist/server.js`)
- `pnpm run lint` — Type-check without emitting (`tsc --noEmit`)

## Project Conventions

- **Module system:** ESM (`"type": "module"`). All internal imports must use `.js` extensions even for `.ts` files (NodeNext module resolution).
- **TypeScript:** Strict mode enabled. No unused locals/parameters. `noImplicitReturns` and `noFallthroughCasesInSwitch` are on.
- **Naming:** Hungarian notation is used project-wide:
  - `str*` strings, `n*` numbers, `b*` booleans, `obj*` objects, `arr*` arrays
  - `fn*` functions, `map*` Maps, `set*` Sets, `stmt*` prepared statements
  - `db*` database connections, `timer*` intervals/timeouts

## Architecture

The server is a Fastify app with WebSocket support, using `better-sqlite3` for synchronous SQLite I/O.

### Entry Point (`src/server.ts`)

- Initializes Fastify, registers `@fastify/cors` and `@fastify/websocket`
- Registers all route modules from `src/routes/`
- Starts background jobs: retention (hourly), heartbeat monitor (every 5s), hourly precompute (every 10m)
- Graceful shutdown on `SIGINT`/`SIGTERM`: clears timers, closes Fastify, closes DB connection

### Configuration (`src/config.ts`)

- Validates `process.env` with Zod at module load time
- Calls `process.exit(1)` on validation failure
- All tunables (retention days, rate limits, intervals, thresholds) live here as `objConfig`

### Data Access Layer (`src/store/`)

- **Singleton DB connection** (`db.ts`): `getDb()` lazily opens `better-sqlite3` with WAL mode and runs migrations. Store modules call `getDb()` at the top level, so importing any store module triggers DB init.
- **Prepared statements** are compiled once at module load time in each store file (`metrics-store.ts`, `aggregation.ts`, `retention.ts`).
- **No ORM or query builder**: raw SQL with `?` placeholders.
- **Schema:** `metrics` table for raw data, `hourly_stats` for precomputed aggregations.

### Routes (`src/routes/`)

Each file exports an async `register*Route(objApp: FastifyInstance)` function. Routes:

- `POST /ingest` — Bearer token auth (from `INGEST_TOKEN` env), Zod body validation, per-device rate limiting (100 req/min in-memory), inserts metric and broadcasts WebSocket `update`.
- `GET /health` — DB size, device count, uptime, last ingest timestamp.
- `GET /devices` — Known devices with online/offline status (30s threshold from in-memory `mapLastSeen`).
- `GET /api/metrics/:deviceId` — `resolution` query: `raw` (last 10k, newest first), `hourly`, `daily`.

### WebSocket (`src/websocket/stream.ts`)

- `WS /stream?deviceId=xxx` — On connect, sends `init` with last 100 raw metrics for that device.
- Maintains `Set<WebSocket>` of connected clients and `Map<string, number>` of last-seen timestamps.
- `broadcastUpdate`, `broadcastDeviceOnline`, `broadcastDeviceOffline` iterate the client set.
- `markDeviceSeen()` is called from the ingest route. If the device was unknown, `device-online` is broadcast.
- Heartbeat monitor checks every 5s; devices silent >30s get `device-offline` broadcast and are removed from `mapLastSeen`.

### Background Jobs

- **Retention** (`src/store/retention.ts`): Deletes metrics older than 7 days and orphaned `hourly_stats`, then runs `VACUUM`. Runs immediately on startup and every hour.
- **Precompute** (`src/store/aggregation.ts`): Recomputes `hourly_stats` for the last hour across all known devices. Runs immediately on startup and every 10 minutes.

### Types (`src/types/`)

- Domain types and a custom `better-sqlite3.d.ts` declaration file (the `@types/better-sqlite3` package installed by pnpm is not hoisted to root `node_modules`, so a local declaration is needed for the compiler).

## Testing

There is no test framework or test suite currently. The project was specified as "tests not needed, but structure testable."
