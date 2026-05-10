# WebSocket in sysbeat: Detailed Guide

## 1. What is WebSocket (in simple terms)

Regular HTTP works on a "request-response" basis: the client asks, the server answers. After the response the connection closes. This is a problem if you need to **constantly** receive updates (for example, for a dashboard with real-time CPU charts).

**WebSocket** is a protocol that establishes a **persistent** connection between the client (browser) and the server. After the connection is established, **both sides** can send messages at any time, without new HTTP requests.

### Analogy

- **HTTP** — like SMS: sent, got a reply, done.
- **WebSocket** — like a phone call: picked up the receiver, and both talk as long as they want until someone hangs up.

### How the connection is established

```
Client                          Server
   |                                |
   |--- HTTP GET with header ----->|  "Upgrade: websocket"
   |    "I want to switch to WS"    |
   |<-- HTTP 101 Switching --------|  "ok, switching"
   |     Protocols                 |
   |                                |
   |====== WebSocket ============|  <-- persistent connection
   |                                |
   |<-- server sends data --------|
   |--- client sends data ------->|
   |<-- server sends data --------|
```

Important: the handshake starts as a regular HTTP request, but the server responds with code `101` and from that point the protocol switches to WebSocket.

---

## 2. Why WebSocket in sysbeat

The project is a dashboard for monitoring Linux devices. There are three participants:

1. **Collector** (script on the device) — sends metrics to the server via `POST /ingest`.
2. **Server** — receives metrics, stores them in SQLite, sends updates to clients.
3. **Dashboard** (frontend in the browser) — connects to the server via WebSocket and **sees metrics in real time**.

### Why not just polling?

Polling = the browser makes `GET /api/metrics` every second. This means:
- Extra load on the server (thousands of empty requests).
- Delay: a new metric only appears on the next request.
- Hard to detect the moment when a device "disappeared".

WebSocket solves all of this: the server **itself** sends data when it appears.

---

## 3. WebSocket architecture in the project

### 3.1. Clients and states

```
+---------------+
|  Dashboard 1  |<---+
+---------------+    |
                     |
+---------------+    |     +------------------+
|  Dashboard 2  |<---+---->|   Set<WebSocket>  |  (all connected clients)
+---------------+    |     +------------------+
                     |              |
+---------------+    |              v
|  Dashboard 3  |<---+     +------------------+
+---------------+         |  Server Fastify  |
                          |                  |
                          |  +------------+  |
                          |  | SQLite DB  |  |
                          |  +------------+  |
                          +------------------+
                                   ^
                                   |
                          +---------------+
                          |   Collector   |
                          |  (POST /ingest)|
                          +---------------+
```

### 3.2. Where the code lives

All WebSocket functions are in one file:

```
src/websocket/stream.ts
```

There are three important concepts:

| Variable | Type | Purpose |
|----------|------|---------|
| `setClients` | `Set<WebSocket>` | All currently connected clients |
| `mapLastSeen` | `Map<string, number>` | When each device last sent metrics |
| `WS_OPEN` | constant `1` | "Connection is open" state |

---

## 4. Detailed code breakdown

### 4.1. WebSocket route registration

**File:** `src/server.ts:35`

```typescript
await objApp.register(websocket);
await registerStreamRoute(objApp);
```

`@fastify/websocket` is a plugin for Fastify. It adds the ability to handle WebSocket connections just like HTTP routes.

**File:** `src/websocket/stream.ts:88-132`

```typescript
export async function registerStreamRoute(objApp: FastifyInstance): Promise<void> {
  objApp.get('/stream', { websocket: true }, (objSocket, objReq) => {
    // ...
  });
}
```

The key thing here: Fastify sees the flag `{ websocket: true }` and understands that this route is not for HTTP, but for WebSocket. Instead of a regular HTTP response it "upgrades" the connection to WebSocket.

### 4.2. What happens when a client connects

When the dashboard opens `ws://localhost:3000/stream?deviceId=test-pi`, the server calls the handler:

```typescript
objApp.get('/stream', { websocket: true }, (objSocket, objReq) => {
  const objQuery = (objReq.query ?? {}) as Record<string, string | undefined>;
  const strDeviceId = objQuery.deviceId;

  setClients.add(objSocket);  // <-- remembered the client

  // If deviceId is specified — send history
  if (strDeviceId) {
    const arrMetrics = getMetricsRaw(strDeviceId, 0, Date.now(), objConfig.nInitMetricsLimit);
    // ... transform DB data into a full metric object ...
    sendToClient(objSocket, {
      type: 'init',
      deviceId: strDeviceId,
      metrics: arrPayloads.reverse(),  // oldest first
    });
  }

  // Socket event handlers
  objSocket.on('close', () => {
    setClients.delete(objSocket);  // <-- removed client on disconnect
  });

  objSocket.on('error', (objErr: Error) => {
    objApp.log.warn({ err: objErr }, 'WebSocket error');
    setClients.delete(objSocket);
  });
});
```

**Important points:**

1. **`setClients.add(objSocket)`** — the server keeps a list of all "live" connections. Like a list of participants in a conference call.
2. **`sendToClient(objSocket, { type: 'init', ... })`** — immediately after connection the server sends the last 100 metrics from the DB. So the chart is not empty.
3. **`objSocket.on('close', ...)`** — when the client closes the tab or leaves, the socket closes. It is mandatory to remove it from `setClients`, otherwise there will be a **memory leak**.

### 4.3. How the server sends a message to one client

```typescript
function sendToClient(objSocket: WebSocket, objMessage: IWebSocketMessage): void {
  try {
    objSocket.send(JSON.stringify(objMessage));
  } catch {
    // If the socket closed between the check and the send
    objSocket.close();
  }
}
```

Simply take a JavaScript object, turn it into a JSON string (`JSON.stringify`) and send it via `objSocket.send()`. `try/catch` is needed because between the state check and the actual send the client might have disconnected.

### 4.4. Broadcast — send to all

When the collector sends a new metric via `POST /ingest`, the server must notify all connected dashboards:

```typescript
export function broadcastUpdate(objMetric: IMetricPayload): void {
  const objMessage: IWebSocketMessage = {
    type: 'update',
    deviceId: objMetric.deviceId,
    metric: objMetric,
  };

  for (const objClient of setClients) {
    if (objClient.readyState === WS_OPEN) {
      sendToClient(objClient, objMessage);
    }
  }
}
```

**How it works:**

1. Form a message with `type: 'update'` and the metric itself.
2. Iterate over all clients from `setClients`.
3. Check `readyState === WS_OPEN` (1) — only active ones receive the message.
4. Send to each.

Essentially, this is a `for...of` loop over an array (more precisely, a `Set`) of sockets.

### 4.5. Message types

All messages are described in `src/types/index.ts`:

```typescript
export type IWebSocketMessage =
  | { type: 'init'; deviceId: string; metrics: IMetricPayload[] }
  | { type: 'update'; deviceId: string; metric: IMetricPayload }
  | { type: 'device-online'; deviceId: string }
  | { type: 'device-offline'; deviceId: string }
  | { type: 'aggregation'; deviceId: string; data: IAggregationBucket[] };
```

| Type | When sent | What it contains |
|------|-----------|------------------|
| `init` | On client connect | Last 100 metrics of the device from the DB |
| `update` | On every new `POST /ingest` | One fresh metric |
| `device-online` | When a device sends its first metric | Only `deviceId` |
| `device-offline` | When a device is silent for >30 seconds | Only `deviceId` |
| `aggregation` | (reserved) | — |

### 4.6. Heartbeat and online/offline

The server needs to know if a device is alive. For this there is `mapLastSeen`:

```
"raspberry-pi-4" -> 1715251200000  (timestamp in ms)
"homelab-nuc"    -> 1715251215000
```

**How it is updated:**

Every time `POST /ingest` arrives:

```typescript
// ingest.ts
const bWasKnown = markDeviceSeen(objMetric.deviceId);
```

```typescript
// stream.ts
export function markDeviceSeen(strDeviceId: string): boolean {
  const bWasKnown = mapLastSeen.has(strDeviceId);
  mapLastSeen.set(strDeviceId, Date.now());  // recorded current time
  return bWasKnown;  // returned whether the device was already known
}
```

If `bWasKnown === false`, the device has just "appeared", and the server broadcasts `device-online` to all clients.

**How offline is determined:**

Every 5 seconds a check is run:

```typescript
export function startHeartbeatMonitor(): NodeJS.Timeout {
  const fnCheck = (): void => {
    const nNow = Date.now();
    for (const [strDeviceId, nLastSeen] of mapLastSeen.entries()) {
      if (nNow - nLastSeen >= objConfig.nDeviceOfflineThresholdMs) {  // 30 sec
        broadcastDeviceOffline(strDeviceId);  // to all: "device is gone"
        mapLastSeen.delete(strDeviceId);       // removed from the list
      }
    }
  };

  return setInterval(fnCheck, objConfig.nHeartbeatCheckMs);  // every 5 sec
}
```

**Why 5-second check with a 30-second threshold?**

So the delay between "device disappeared" and "server noticed" is no more than 5 seconds (not 30).

### 4.7. Full flow: collector → server → dashboards

```
Collector
   |
   | POST /ingest
   | { deviceId: "pi", cpu: {...}, memory: {...} }
   v
Server: ingest.ts
   |
   |-- 1. Bearer token check
   |-- 2. Rate limit
   |-- 3. markDeviceSeen("pi")
   |       └── if device is new:
   |           broadcastDeviceOnline("pi")
   |           └── for each client in setClients:
   |               sendToClient({ type: "device-online", deviceId: "pi" })
   |
   |-- 4. insertMetric() → SQLite
   |-- 5. setImmediate(() => broadcastUpdate(metric))
   |       └── for each client in setClients:
   |           sendToClient({ type: "update", deviceId: "pi", metric: {...} })
   |
   v
Dashboard 1  <-- "update"
Dashboard 2  <-- "update"
Dashboard 3  <-- "update"
```

`setImmediate` is important here: it defers the broadcast to the next tick of the event loop, so the HTTP response to `POST /ingest` is sent to the client **immediately**, without waiting for the messages to be sent to all WebSocket clients.

### 4.8. Graceful disconnect

When a client closes the connection (closed the tab, refreshed the page, lost network), the server receives a `close` event:

```typescript
objSocket.on('close', () => {
  setClients.delete(objSocket);  // removed from the list
});
```

If this is not done, `setClients` will grow infinitely and the server will run out of memory.

---

## 5. What it looks like on the client side (JavaScript in the browser)

Although the client code is not in this repository, it is important to understand how it works:

```javascript
// Connect
const socket = new WebSocket('ws://localhost:3000/stream?deviceId=test-pi');

// Connection established
socket.addEventListener('open', () => {
  console.log('Connected to server');
});

// Message from the server
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'init') {
    // Draw history on the chart
    console.log('History:', msg.metrics);
  }

  if (msg.type === 'update') {
    // Add a new point to the chart
    console.log('New metric:', msg.metric);
  }

  if (msg.type === 'device-online') {
    // Show green indicator
    console.log('Device online:', msg.deviceId);
  }

  if (msg.type === 'device-offline') {
    // Show red indicator
    console.log('Device offline:', msg.deviceId);
  }
});

// Connection closed
socket.addEventListener('close', () => {
  console.log('Disconnected');
});
```

---

## 6. Frequently asked questions

### Why `Set<WebSocket>` instead of an array?

`Set` automatically prevents duplicates. If the same socket is accidentally added twice, `Set` stores it once.

### What happens if you send a message to a closed socket?

```typescript
objSocket.send('...');  // may throw an error
```

That's why there is `try/catch` in `sendToClient`.

### Why `readyState === 1`?

`WebSocket.readyState` has 4 values:
- `0` — connection is being established
- `1` — connection is open (`WS_OPEN`)
- `2` — connection is closing
- `3` — connection is closed

We check `=== 1` so we don't try to write to a "dead" socket.

### Why doesn't heartbeat use WebSocket ping/pong?

Built-in ping/pong in WebSocket works at the TCP connection level and checks if the **client** (dashboard) is alive. But we need to check if the **device** (collector) that sends data via HTTP is alive. Therefore we use our own logic based on `mapLastSeen`.

### What if the server crashes? What will clients see?

The socket will close, the client will receive a `close` or `error` event. The frontend should reconnect (usually with exponential delay: 1s, 2s, 4s, 8s...).

---

## 7. Key files

| File | What it does |
|------|------------|
| `src/websocket/stream.ts` | All WebSocket: connection, broadcast, heartbeat |
| `src/routes/ingest.ts` | Receives metrics and calls `broadcastUpdate` / `markDeviceSeen` |
| `src/server.ts` | Registers `@fastify/websocket`, starts heartbeat monitor |
| `src/types/index.ts` | Message types (`IWebSocketMessage`, etc.) |

---

## 8. Manual verification

You cannot test WebSocket via `curl`, but you can via Node.js:

```bash
# Terminal 1: start the server
cd server && pnpm run dev

# Terminal 2: send a metric
curl -X POST -H "Authorization: Bearer change-me-in-production" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","timestamp":'$(date +%s%3N)',"cpu":{"usage":10,"user":5,"system":3,"idle":82},"memory":{"total":8192,"used":4096,"free":4096,"percent":50},"load":[0.5,0.4,0.3]}' \
  http://localhost:3000/ingest

# Terminal 3: connect as a client
node -e "
const ws = require('ws');
const c = new ws('ws://localhost:3000/stream?deviceId=test');
c.on('open', () => console.log('Connected'));
c.on('message', d => console.log(JSON.parse(d.toString())));
"
```

You will see:
1. `type: 'init'` — metric history on connect
2. `type: 'update'` — new metric when `POST /ingest` arrives
