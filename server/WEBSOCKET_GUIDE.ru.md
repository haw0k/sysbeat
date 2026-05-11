# WebSocket в sysbeat: подробное руководство

## 1. Что такое WebSocket (простыми словами)

Обычный HTTP работает по принципу "запрос-ответ": клиент спрашивает, сервер отвечает. После ответа соединение закрывается. Это проблема, если нужно **постоянно** получать обновления (например, для дашборда с графиками CPU в реальном времени).

**WebSocket** — это протокол, который устанавливает **постоянное** соединение между клиентом (браузер) и сервером. После установки соединения **обе стороны** могут отправлять сообщения в любой момент, без новых HTTP-запросов.

### Аналогия

- **HTTP** — как SMS: отправил, получил ответ, всё.
- **WebSocket** — как телефонный звонок: поднял трубку, и оба говорят сколько угодно, пока не положат.

### Как устанавливается соединение

```
Клиент                              Сервер
  │                                   │
  │─── HTTP GET, Upgrade: websocket ─▶│  "хочу перейти на WS"
  │                                   │
  │◀─── HTTP 101 Switching ───────────│  "ок, переключаемся"
  │                                   │
  │══════════ WebSocket ══════════════│  <-- постоянное соединение
  │                                   │
  │◀─── сервер шлёт данные ───────────│
  │─── клиент шлёт данные ───────────▶│
  │◀─── сервер шлёт данные ───────────│
```

Важно: установка начинается как обычный HTTP-запрос, но сервер отвечает кодом `101` и дальше протокол меняется на WebSocket.

---

## 2. Зачем WebSocket в sysbeat

Проект — это дашборд для мониторинга Linux-устройств. Есть три участника:

1. **Collector** (скрипт на устройстве) — отправляет метрики на сервер через `POST /ingest`.
2. **Сервер** — принимает метрики, хранит в SQLite, отправляет обновления клиентам.
3. **Dashboard** (фронтенд в браузере) — подключается к серверу через WebSocket и **видит метрики в реальном времени**.

### Почему не просто polling?

Polling = браузер раз в секунду делает `GET /api/metrics`. Это:
- Лишняя нагрузка на сервер (тысячи пустых запросов).
- Задержка: новая метрика появится только при следующем запросе.
- Сложно отследить момент, когда устройство "пропало".

WebSocket решает всё это: сервер **сам** шлёт данные, когда они появляются.

---

## 3. Архитектура WebSocket в проекте

### 3.1. Клиенты и состояния

```
┌───────────────┐
│  Dashboard 1  │◀───┐
└───────────────┘    │
                     │
┌───────────────┐    │     ┌──────────────────┐
│  Dashboard 2  │◀───┼────▶│   Set<WebSocket> │  (все подключённые клиенты)
└───────────────┘    │     └──────────────────┘
                     │               │
┌───────────────┐    │               ▼
│  Dashboard 3  │◀───┘     ┌──────────────────┐
└───────────────┘          │  Сервер Fastify  │
                           │                  │
                           │  ┌─────────────┐ │
                           │  │  SQLite DB  │ │
                           │  └─────────────┘ │
                           └──────────────────┘
                                     ▲
                                     │
                            ┌───────────────┐
                            │   Collector   │
                            │ (POST /ingest)│
                            └───────────────┘
```

### 3.2. Где живёт код

Все WebSocket-функции находятся в одном файле:

```
src/websocket/stream.ts
```

Там четыре важных понятия:

| Переменная | Тип | Назначение |
|------------|-----|-----------|
| `setClients` | `Set<WebSocket>` | Все текущие подключённые клиенты |
| `setOnlineDevices` | `Set<string>` | ID устройств, которые сейчас считаются онлайн |
| `mapLastSeen` | `Map<string, number>` | Когда последний раз каждое устройство присылало метрики |
| `WS_OPEN` | константа `1` | Состояние "соединение открыто" |

---

## 4. Подробный разбор кода

### 4.1. Регистрация WebSocket-роута

**Файл:** `src/server.ts:35`

```typescript
await objApp.register(websocket);
await registerStreamRoute(objApp);
```

`@fastify/websocket` — это плагин для Fastify. Он добавляет возможность обрабатывать WebSocket-соединения так же, как HTTP-роуты.

**Файл:** `src/websocket/stream.ts`

```typescript
import { authenticate } from '../routes/auth.js';

export async function registerStreamRoute(objApp: FastifyInstance): Promise<void> {
  objApp.get('/stream', { websocket: true, preHandler: authenticate }, (objSocket, objReq) => {
    // ...
  });
}
```

Здесь происходит ключевое: Fastify видит флаг `{ websocket: true }` и понимает, что этот роут не для HTTP, а для WebSocket. `preHandler: authenticate` выполняется до апгрейда — если токен невалиден, клиент получает HTTP 401 и апгрейд блокируется.

### 4.2. Что происходит при подключении клиента

Когда dashboard открывает `ws://localhost:3000/stream?deviceId=test-pi&token=xxx`, сервер вызывает обработчик:

```typescript
objApp.get('/stream', { websocket: true }, (objSocket, objReq) => {
  const objQuery = (objReq.query ?? {}) as Record<string, string | undefined>;
  const strDeviceId = objQuery.deviceId;

  setClients.add(objSocket);  // <-- запомнили клиента

  // Если указан deviceId — отправляем историю
  if (strDeviceId) {
    const arrMetrics = getMetricsRaw(strDeviceId, 0, Date.now(), objConfig.nInitMetricsLimit);
    // ... преобразуем данные из БД в полноценный объект метрики ...
    sendToClient(objSocket, {
      type: 'init',
      deviceId: strDeviceId,
      metrics: arrPayloads.reverse(),  // старые сначала
    });
  }

  // Обработчики событий сокета
  objSocket.on('close', () => {
    setClients.delete(objSocket);  // <-- убрали клиента при отключении
  });

  objSocket.on('error', (objErr: Error) => {
    objApp.log.warn({ err: objErr }, 'WebSocket error');
    setClients.delete(objSocket);
  });
});
```

**Важные моменты:**

1. **`setClients.add(objSocket)`** — сервер ведёт список всех "живых" соединений. Это как список абонентов в конференц-звонке.
2. **`sendToClient(objSocket, { type: 'init', ... })`** — сразу после подключения сервер шлёт последние 100 метрик из БД. Это чтобы график не был пустым.
3. **`objSocket.on('close', ...)`** — когда клиент закрывает вкладку или уходит, сокет закрывается. Нужно обязательно удалить его из `setClients`, иначе будет **утечка памяти**.

### 4.3. Как сервер шлёт сообщение одному клиенту

```typescript
function sendToClient(objSocket: WebSocket, objMessage: IWebSocketMessage): void {
  try {
    objSocket.send(JSON.stringify(objMessage));
  } catch {
    // Если сокет закрылся между проверкой и отправкой
    objSocket.close();
  }
}
```

Просто берём объект JavaScript, превращаем в JSON-строку (`JSON.stringify`) и отправляем через `objSocket.send()`. `try/catch` нужен, потому что между проверкой состояния и реальной отправкой клиент мог отключиться.

### 4.4. Broadcast — разослать всем

Когда collector прислал новую метрику через `POST /ingest`, сервер должен сообщить об этом всем подключённым dashboard'ам:

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

**Как это работает:**

1. Формируем сообщение с `type: 'update'` и самой метрикой.
2. Перебираем всех клиентов из `setClients`.
3. Проверяем `readyState === WS_OPEN` (1) — только активные получат сообщение.
4. Отправляем каждому.

По сути, это цикл `for...of` по массиву (точнее, `Set`) сокетов.

### 4.5. Типы сообщений

Все сообщения описаны в `src/types/index.ts`:

```typescript
export type IWebSocketMessage =
  | { type: 'init'; deviceId: string; metrics: IMetricPayload[] }
  | { type: 'update'; deviceId: string; metric: IMetricPayload }
  | { type: 'device-online'; deviceId: string }
  | { type: 'device-offline'; deviceId: string }
  | { type: 'aggregation'; deviceId: string; data: IAggregationBucket[] };
```

| Тип | Когда отправляется | Что содержит |
|-----|-------------------|--------------|
| `init` | При подключении клиента | Последние 100 метрик устройства из БД |
| `update` | При каждом новом `POST /ingest` | Одна свежая метрика |
| `device-online` | Когда устройство впервые прислало метрику | Только `deviceId` |
| `device-offline` | Когда устройство молчит >30 секунд | Только `deviceId` |
| `aggregation` | (зарезервировано) | — |

### 4.6. Heartbeat и online/offline

Сервер должен понимать, живо ли устройство. Для этого есть `mapLastSeen`:

```
"raspberry-pi-4" -> 1715251200000  (timestamp в ms)
"homelab-nuc"    -> 1715251215000
```

**Как обновляется:**

Каждый раз, когда приходит `POST /ingest`:

```typescript
// ingest.ts
const bWasKnown = markDeviceSeen(objMetric.deviceId);
```

```typescript
// stream.ts
export function markDeviceSeen(strDeviceId: string): boolean {
  const bWasKnown = setOnlineDevices.has(strDeviceId);
  mapLastSeen.set(strDeviceId, Date.now());
  setOnlineDevices.add(strDeviceId);
  return bWasKnown;
}
```

Если `bWasKnown === false`, значит устройство только что "появилось", и сервер рассылает `device-online` всем клиентам.

**Как определяется offline:**

Раз в 5 секунд запускается проверка:

```typescript
export function startHeartbeatMonitor(): NodeJS.Timeout {
  const fnCheck = (): void => {
    const nNow = Date.now();
    const arrOffline: string[] = [];
    for (const strDeviceId of setOnlineDevices) {
      const nLastSeen = mapLastSeen.get(strDeviceId) ?? 0;
      if (nNow - nLastSeen >= objConfig.nDeviceOfflineThresholdMs) {
        arrOffline.push(strDeviceId);
      }
    }
    for (const strDeviceId of arrOffline) {
      setOnlineDevices.delete(strDeviceId);
      broadcastDeviceOffline(strDeviceId);
    }
  };

  return setInterval(fnCheck, objConfig.nHeartbeatCheckMs);
}
```

**Почему 5 секунд проверка при пороге 30 секунд?**

Чтобы задержка между "устройство пропало" и "сервер заметил" была не больше 5 секунд (а не 30).

### 4.7. Полный flow: collector → сервер → dashboards

```
Collector
   |
   | POST /ingest
   | { deviceId: "pi", cpu: {...}, memory: {...} }
   v
Сервер: ingest.ts
   |
   |-- 1. Проверка Bearer token
   |-- 2. Rate limit
   |-- 3. markDeviceSeen("pi")
   |       └── если устройство новое:
   |           broadcastDeviceOnline("pi")
   |           └── для каждого клиента в setClients:
   |               sendToClient({ type: "device-online", deviceId: "pi" })
   |
   |-- 4. insertMetric() → SQLite
   |-- 5. setImmediate(() => broadcastUpdate(metric))
   |       └── для каждого клиента в setClients:
   |           sendToClient({ type: "update", deviceId: "pi", metric: {...} })
   |
   v
Dashboard 1  <-- "update"
Dashboard 2  <-- "update"
Dashboard 3  <-- "update"
```

`setImmediate` здесь важен: он откладывает broadcast на следующий тик event loop, чтобы HTTP-ответ `POST /ingest` ушёл клиенту **мгновенно**, не дожидаясь отправки сообщений всем WebSocket-клиентам.

### 4.8. Graceful disconnect

Когда клиент закрывает соединение (закрыл вкладку, обновил страницу, потерял сеть), сервер получает событие `close`:

```typescript
objSocket.on('close', () => {
  setClients.delete(objSocket);  // убрали из списка
});
```

Если этого не делать, `setClients` будет расти бесконечно, и сервер упадёт от нехватки памяти.

---

## 5. Как это выглядит на стороне клиента (JavaScript в браузере)

Клиентский код находится в `dashboard/src/hooks/useWebSocket.ts` в этом репозитории:

```javascript
// Подключаемся (с токеном аутентификации в query-параметре)
const socket = new WebSocket('ws://localhost:3000/stream?deviceId=test-pi&token=xxx');

// Соединение установлено
socket.addEventListener('open', () => {
  console.log('Подключились к серверу');
});

// Пришло сообщение от сервера
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'init') {
    // Рисуем историю на графике
    console.log('История:', msg.metrics);
  }

  if (msg.type === 'update') {
    // Добавляем новую точку на график
    console.log('Новая метрика:', msg.metric);
  }

  if (msg.type === 'device-online') {
    // Показываем зелёный индикатор
    console.log('Устройство онлайн:', msg.deviceId);
  }

  if (msg.type === 'device-offline') {
    // Показываем красный индикатор
    console.log('Устройство оффлайн:', msg.deviceId);
  }
});

// Соединение закрыто
socket.addEventListener('close', () => {
  console.log('Отключились');
});
```

---

## 6. Частые вопросы

### Почему `Set<WebSocket>`, а не массив?

`Set` автоматически предотвращает дубликаты. Если по ошибке добавить один и тот же сокет дважды, `Set` хранит его один раз.

### Что будет, если отправить сообщение в закрытый сокет?

```typescript
objSocket.send('...');  // может выбросить ошибку
```

Поэтому в коде есть `try/catch` в `sendToClient`.

### Почему `readyState === 1`?

`WebSocket.readyState` имеет 4 значения:
- `0` — соединение устанавливается
- `1` — соединение открыто (`WS_OPEN`)
- `2` — соединение закрывается
- `3` — соединение закрыто

Проверяем `=== 1`, чтобы не пытаться писать в "мертвый" сокет.

### Почему heartbeat не использует WebSocket ping/pong?

Встроенные ping/pong в WebSocket работают на уровне TCP-соединения и проверяют, жив ли **клиент** (dashboard). Но нам нужно проверять, живо ли **устройство** (collector), которое шлёт данные через HTTP. Поэтому используем собственную логику на основе `mapLastSeen`.

### Что если сервер упадёт? Что увидят клиенты?

Сокет закроется, клиент получит событие `close` или `error`. Фронтенд должен переподключиться (обычно с экспоненциальной задержкой: 1с, 2с, 4с, 8с...).

---

## 7. Ключевые файлы

| Файл | Что делает |
|------|-----------|
| `src/websocket/stream.ts` | Весь WebSocket: подключение, broadcast, heartbeat |
| `src/routes/ingest.ts` | Получает метрики и вызывает `broadcastUpdate` / `markDeviceSeen` |
| `src/server.ts` | Регистрирует `@fastify/websocket`, запускает heartbeat monitor |
| `src/types/index.ts` | Типы сообщений (`IWebSocketMessage` и др.) |

---

## 8. Проверка вручную

Можно протестировать WebSocket через `curl` нельзя, но можно через Node.js:

```bash
# В терминале 1: запускаем сервер
cd server && pnpm run dev

# В терминале 2: шлём метрику
curl -X POST -H "Authorization: Bearer change-me-in-production" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","timestamp":'$(date +%s%3N)',"cpu":{"usage":10,"user":5,"system":3,"idle":82},"memory":{"total":8192,"used":4096,"free":4096,"percent":50},"load":[0.5,0.4,0.3]}' \
  http://localhost:3000/ingest

# В терминале 3: подключаемся как клиент
node -e "
const ws = require('ws');
const c = new ws('ws://localhost:3000/stream?deviceId=test&token=change-me-in-production');
c.on('open', () => console.log('Подключились'));
c.on('message', d => console.log(JSON.parse(d.toString())));
"
```

Вы увидите:
1. `type: 'init'` — история метрик при подключении
2. `type: 'update'` — новая метрика, когда придёт `POST /ingest`
