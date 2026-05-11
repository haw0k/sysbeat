# Collector in sysbeat: Detailed Guide

## 1. What is the Collector and why it is needed

**Collector** is a script (program) that runs on a Linux device and **collects system metrics**: CPU load, memory usage, system load. These data are then sent to the server.

### Analogy

Imagine you have a smart home. In every room there is a temperature sensor. **Collector** is exactly that sensor: it reads the values (from `/proc`) and sends them to the central panel (server). The server, in turn, displays these data on the screen (dashboard) via WebSocket.

### Three participants in the system

```
┌───────────────┐      HTTP POST       ┌───────────────┐      WebSocket       ┌───────────────┐
│   Collector   │ ──────────────────▶  │    Server     │ ──────────────────▶  │   Dashboard   │
│  (on Linux    │    here are my       │  (receives,   │    new data!         │  (browser,    │
│   device)     │    metrics           │   stores,      │                      │   sees chart) │
└───────────────┘                      │   broadcasts)  │                      └───────────────┘
                                       └───────────────┘
```

The Collector **does not use WebSocket directly** — it sends regular HTTP requests. But it is the **source of data** for the entire system, including the WebSocket broadcast to the dashboard.

---

## 2. Where the Collector gets data from

In Linux there is a special virtual filesystem `/proc` — these are not real files on disk, but "windows" into the operating system kernel. Through them you can find out what is happening in the system right now.

### 2.1. `/proc/stat` — CPU load

Example content:

```
cpu  2255 34 2290 25563 6290 127 456 0 0 0
cpu0 1132 17 1145 12781 3145 63 228 0 0 0
intr 1234567 ...
```

The collector reads the **first line** starting with `cpu ` (with a space!). The numbers represent time (in CPU ticks) the system spent on:

| Field | Meaning |
|-------|---------|
| 1 (user) | Regular user programs |
| 2 (nice) | Programs with lowered priority |
| 3 (system) | Kernel work (drivers, system calls) |
| 4 (idle) | CPU is idle |
| 5 (iowait) | Waiting for disk |
| 6 (irq) | Hardware interrupts |
| 7 (softirq) | Software interrupts |
| 8 (steal) | Virtualization (if the system is inside a VM) |

**How CPU load is calculated:**

You cannot simply take one value from `/proc/stat` and say "load is 45%". You need to **compare two measurements over time**:

```
Measurement 1 (now):    user=1000, system=500, idle=8000
Measurement 2 (in 1s):  user=1050, system=520, idle=8430

Difference:              user=+50,  system=+20, idle=+430
Total ticks: 50 + 20 + 430 = 500

usage = (50 + 20) / 500 * 100 = 14%   <-- loaded at 14%
idle  = 430 / 500 * 100 = 86%          <-- idle 86%
```

This is what the Collector does: it remembers previous values and calculates the difference on the next measurement.

### 2.2. `/proc/meminfo` — memory

Example:

```
MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          4096000 kB
```

Everything is in **kilobytes** (kB). The collector divides by 1024 to get megabytes.

| Field | Meaning |
|-------|---------|
| MemTotal | All RAM |
| MemAvailable | How much is available right now (without clearing cache) |
| MemFree | Completely free (not used at all) |

**Formulas:**
```
used = total - available
percent = used / total * 100
free = MemFree (completely unused memory)
```

**Important distinction:**
- `memory.free` in the payload = `MemFree` — memory that is not used at all.
- `memory.used` is calculated as `total - available` (where `available` includes cache and buffers that can be freed).
- Thus `free + used ≠ total` — this is normal, because part of the memory is occupied by the filesystem cache.

If `MemAvailable` is missing (old Linux), we use `MemFree + Buffers + Cached` to calculate `used`.

### 2.3. `/proc/loadavg` — load average

Example:

```
0.25 0.15 0.10 2/345 12345
```

The first three numbers are the **average number of processes** waiting for the CPU:
- `0.25` — over the last minute
- `0.15` — over the last 5 minutes
- `0.10` — over the last 15 minutes

A value of `1.0` means the CPU is 100% loaded (all cores busy). If you have 4 cores, `4.0` is full load.

---

## 3. How the Collector parses /proc (parser.ts breakdown)

### 3.1. Reading the file

```typescript
import { readFileSync } from 'fs';

const strContent = readFileSync('/proc/stat', 'utf-8');
```

`readFileSync` — synchronous reading. This is fine because `/proc` is a virtual FS, the file is read instantly from kernel memory. No disk access.

### 3.2. Parsing CPU

```typescript
const strCpuLine = strContent.split('\n').find((strLine) => strLine.startsWith('cpu '));
```

We look for the line starting with `cpu ` (with a space). Important: `cpu0`, `cpu1`, etc. are individual cores, and `cpu ` is the aggregate statistics.

```typescript
const arrFields = strCpuLine.trim().split(/\s+/).slice(1).map(Number);
```

- `trim()` — removes extra spaces
- `split(/\s+/)` — splits by spaces (one or more)
- `slice(1)` — skips the word `cpu`
- `map(Number)` — converts strings to numbers

### 3.3. Storing previous values

```typescript
let nPrevUser = 0;
let nPrevSystem = 0;
let nPrevIdle = 0;
let bFirstRun = true;
```

These variables live **outside the function** — at module level. They persist between calls. This is important: on the first run there is nothing to compare with, so we return `usage: 0`.

### 3.4. Calculating delta

```typescript
if (bFirstRun) {
  bFirstRun = false;
  nPrevUser = nUser;
  // ... save all values
  return { nUsage: 0, nUser: 0, nSystem: 0, nIdle: 100 };
}

const nDeltaTotal = nTotal - nPrevTotal;
const nUsage = 100 * (nDeltaUser + nDeltaSystem + nDeltaIrq + nDeltaSoftirq) / nDeltaTotal;
```

The formula includes:
- `user` — user programs
- `system` — kernel
- `irq` and `softirq` — interrupts

Not included:
- `idle` — idle time
- `iowait` — disk wait (considered inactive)
- `nice` — lowered priority (can be included or excluded)

### 3.5. Parsing memory

```typescript
for (const strLine of strContent.split('\n')) {
  const arrMatch = strLine.match(/^([A-Za-z()]+):\s+(\d+)\s+kB/);
  if (arrMatch) {
    mapValues.set(arrMatch[1], Number(arrMatch[2]));
  }
}
```

We use a **regular expression**:
- `^` — start of line
- `([A-Za-z()]+)` — name (e.g. `MemTotal`)
- `:\s+` — colon and spaces
- `(\d+)` — number
- `\s+kB` — spaces and `kB`

The result is stored in a `Map` — a convenient dictionary where you can quickly get a value by name.

---

## 4. Sending to the server (sender.ts breakdown)

### 4.1. Why no external libraries

Node.js has built-in modules `http` and `https`. They allow making requests without `axios` or `node-fetch`. This means:
- Fewer dependencies (no update issues)
- Smaller size (important for embedded devices)
- Understanding "how it works under the hood"

### 4.2. HTTP request "by hand"

```typescript
import { request } from 'https';
import { request as requestHttp } from 'http';

const fnRequest = objUrl.protocol === 'https:' ? request : requestHttp;

const objReq = fnRequest(objRequestOptions, (objRes) => {
  // handle response
});

objReq.write(strBody);
objReq.end();
```

**How it works:**

1. We create a request object `objReq` via `request(options, callback)`
2. `callback` is called when the server sends **response headers**
3. `objRes.on('data', ...)` — we read the response body in chunks
4. `objRes.on('end', ...)` — the response is fully received
5. `objReq.write(strBody)` — we send the request body
6. `objReq.end()` — we finish the request

This is **asynchronous**: `request()` does not block the program. Node.js continues working, and when the response arrives — it calls the callback.

### 4.3. Retry with exponential backoff

What if the server is unreachable? You cannot simply crash with an error — the device might temporarily lose connection.

```typescript
while (true) {
  nAttempt++;
  const objResult = await trySend(objPayload);

  if (objResult.bSuccess) return objResult;

  const nWait = Math.min(nBackoffMs + nJitter, nMaxBackoffMs);
  await sleep(nWait);
  nBackoffMs = Math.min(nBackoffMs * 2, nMaxBackoffMs);
}
```

**Principle:**

| Attempt | Delay |
|---------|-------|
| 1 | 1 sec + jitter |
| 2 | 2 sec + jitter |
| 3 | 4 sec + jitter |
| 4 | 8 sec + jitter |
| 5+ | 30 sec (max) |

**Jitter** — random number 0–200 ms. Needed so that if 1000 devices simultaneously lose connection, they do not all start bombarding the server **at the same time** after recovery.

### 4.4. Timeout

```typescript
objReq.on('timeout', () => {
  objReq.destroy();  // <-- forcibly close the connection
});
```

If the server does not respond within 5 seconds, the connection is terminated. Without this the program could wait forever.

---

## 5. Main loop (index.ts breakdown)

### 5.1. Architecture

```
┌────────────┐      ┌────────────┐      ┌────────────┐      ┌────────────┐
│ setInterval│ ───▶ │ collect()  │ ───▶ │ parse /proc│ ───▶ │ send HTTP  │
│  (every    │      │            │      │            │      │            │
│   second)  │      │            │      │            │      │            │
└────────────┘      └────────────┘      └────────────┘      └────────────┘
```

### 5.2. Overlap protection

```typescript
let bSending = false;

async function collectAndSend(): Promise<void> {
  if (!bRunning) return;
  if (bSending) return;  // <-- skip if previous is not done yet

  bSending = true;
  const objResult = await sendMetrics(objPayload);
  bSending = false;
}
```

If sending takes longer than a second (e.g. due to retry), and `setInterval` fires again — we do not start a new send. This protects against request "overlap".

### 5.3. Graceful shutdown

```typescript
process.on('SIGINT', () => void gracefulShutdown());
process.on('SIGTERM', () => void gracefulShutdown());

async function gracefulShutdown(): Promise<void> {
  bRunning = false;
  clearInterval(timerInterval);

  if (bSending) {
    // Wait for current send to finish
    while (bSending && nWaited < 10000) {
      await sleep(100);
      nWaited += 100;
    }
  }

  process.exit(0);
}
```

**SIGINT** — interrupt signal (Ctrl+C in the terminal).
**SIGTERM** — "please terminate" signal (from systemd when stopping the service).

The collector:
1. Stops the timer (no new measurements start)
2. Waits for the current send to finish (up to 10 seconds)
3. Terminates the process cleanly

This is important: if you simply kill the process (`kill -9`), the last metric might be lost.

### 5.4. Logging

```
[2026-05-09T21:50:27.558Z] cpu: 3.3% mem: 5.6% load: 0.46 status: 200
```

- `[` + ISO timestamp + `]` — when it happened
- `cpu: 3.3%` — CPU load
- `mem: 5.6%` — memory used
- `load: 0.46` — 1-minute load average
- `status: 200` — HTTP response from the server (or `failed` / `retry`)

---

## 6. How the Collector connects to WebSocket

Although the Collector itself does not use WebSocket, it is the **start of the chain** that ends with the WebSocket broadcast.

### Full data flow

```
1. Collector reads /proc/stat, /proc/meminfo, /proc/loadavg
   |
   | (every INTERVAL_MS, e.g. 1 second)
   v
2. Collector forms JSON: { deviceId, timestamp, cpu, memory, load }
   |
   | HTTP POST /ingest
   | Authorization: Bearer <token>
   v
3. Server (Fastify) receives the request:
   - Checks token
   - Checks rate limit
   - Saves to SQLite
   |
   | <-- inside the server --
   v
4. Server calls broadcastUpdate(metric)
   |
   | WebSocket message: { type: "update", deviceId, metric }
   v
5. Dashboard (browser) receives the message
   |
   v
6. Chart on the screen updates in real time
```

**Key point:** WebSocket provides **instant** dashboard updates. Without it, the browser would have to poll the server every second "anything new?", creating extra load.

The Collector simply "feeds" data to the server. The server decides how to deliver it to clients.

---

## 7. Why this project is educational

This collector was created to practically understand:

1. **How to read system information in Linux** — through `/proc`, without external utilities
2. **How HTTP works in Node.js at a low level** — through `http.request`, without wrappers
3. **How to write resilient code** — retry, backoff, graceful shutdown
4. **How to connect multiple components** — collector, server, dashboard

In a real production environment you could:
- Use `axios` or `fetch` instead of manual HTTP
- Use a library like `systeminformation` instead of parsing `/proc`
- Add buffering (store metrics locally when the network is down)

But the goal here is to **understand the mechanism**, not to make it as fast as possible.

---

## 8. Manual verification

```bash
# 1. See what the collector reads
cat /proc/stat | head -1
cat /proc/meminfo | head -3
cat /proc/loadavg

# 2. Start the server (in one terminal)
cd server && pnpm run dev

# 3. Start the collector (in another terminal)
cd collector && pnpm run dev

# 4. Watch the collector logs:
# [2026-05-09T21:50:27.558Z] cpu: 3.3% mem: 5.6% load: 0.46 status: 200

# 5. Verify that the server received data:
curl http://localhost:3000/devices
# [{ "deviceId": "linux-device-1", "isOnline": true }]
```

---

## 9. Key files

| File | What it does |
|------|------------|
| `src/parser.ts` | Reads and parses `/proc/stat`, `/proc/meminfo`, `/proc/loadavg` |
| `src/sender.ts` | Sends HTTP POST with retry and exponential backoff |
| `src/index.ts` | Main loop: timer, graceful shutdown, logging |
| `src/config.ts` | Reading environment variables |
| `src/types.ts` | TypeScript interfaces |
