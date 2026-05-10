# Plan: sysbeat Collector Implementation

## Context

Create the collector component for `sysbeat` — a Node.js script that runs on Linux devices, reads system metrics from `/proc` filesystem, and sends them to the sysbeat server via HTTP POST. This is the second major component of the project, located in a new `collector/` directory parallel to `server/`.

## Files to Create

### Root / Config
1. **`collector/package.json`** — TypeScript project, zero runtime dependencies, scripts: dev, build, start, lint
2. **`collector/tsconfig.json`** — strict TypeScript, Node20 target, ESM
3. **`collector/.env.example`** — SERVER_URL, INGEST_TOKEN, DEVICE_ID, INTERVAL_MS
4. **`collector/nodemon.json`** — watch src/, exec tsx src/index.ts

### Source Code
5. **`collector/src/types.ts`** — IMetricPayload, IMetricPayload interfaces matching server format
6. **`collector/src/config.ts`** — env parsing with zod (or manual validation for zero-deps), defaults
7. **`collector/src/parser.ts`** — readProcStat, readProcMeminfo, readProcLoadavg; manual parsing without external libs
8. **`collector/src/sender.ts`** — httpPost with retry logic (exponential backoff: 1s, 2s, 4s, 8s, max 30s), custom agent with 5s timeout
9. **`collector/src/index.ts`** — main loop: read metrics, compute CPU usage, format payload, send with retry, handle SIGTERM/SIGINT

### Documentation
10. **`collector/README.md`** — setup, environment variables, systemd service example

## Implementation Details

### Zero Runtime Dependencies
- Use only Node.js built-in modules: `fs`, `https`, `http`, `os`, `process`
- No `axios`, `node-fetch`, or similar — raw `http.request` / `https.request`

### CPU Usage Calculation
- Parse `/proc/stat` line starting with `cpu `
- Fields: user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice
- Track previous values to compute deltas
- `usage = 100 * (user + system + irq + softirq - prev) / (total - prev_total)`
- `idle% = 100 * (idle - prev_idle) / (total - prev_total)`

### Memory Parsing
- Parse `/proc/meminfo` for `MemTotal`, `MemAvailable` (or `MemFree` + `Buffers` + `Cached`)
- Convert kB to MB (divide by 1024)
- `used = total - available`
- `percent = used / total * 100`

### Load Average
- Parse `/proc/loadavg`, first 3 numbers are 1m, 5m, 15m

### Retry Logic
- Exponential backoff: 1s, 2s, 4s, 8s, then cap at 30s
- Reset backoff on successful send
- Log each retry attempt

### Graceful Shutdown
- Clear interval on SIGTERM/SIGINT
- Wait for current send to complete (if any)
- Exit with code 0

### Logging Format
- `[2025-01-15T14:32:01Z] cpu: 45% mem: 62% load: 0.25 status: 200`
- ISO timestamp, compact stats, HTTP status or "retry"

## Verification

1. Install deps: `cd collector && pnpm install`
2. Run dev: `pnpm run dev` — collector starts reading /proc and printing logs
3. Test with server: start server in parallel, verify metrics appear in health/devices endpoints
4. Test retry: block server port temporarily, verify backoff logging, then unblock and verify recovery
5. Test shutdown: send SIGTERM, verify clean exit without pending intervals
