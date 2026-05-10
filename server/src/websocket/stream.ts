import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { objConfig } from '../config.js';
import { getMetricsRaw } from '../store/metrics-store.js';
import { authenticate } from '../routes/auth.js';
import type { IMetricPayload, IWebSocketMessage } from '../types/index.js';

const WS_OPEN = 1;

const setClients = new Set<WebSocket>();
const mapLastSeen = new Map<string, number>();
const setOnlineDevices = new Set<string>();

export function getLastSeenMap(): ReadonlyMap<string, number> {
  return new Map(mapLastSeen);
}

/**
 * Track device heartbeat. Returns true if the device was already online.
 */
export function markDeviceSeen(strDeviceId: string): boolean {
  const bWasOnline = setOnlineDevices.has(strDeviceId);
  mapLastSeen.set(strDeviceId, Date.now());
  setOnlineDevices.add(strDeviceId);
  return bWasOnline;
}

function sendToClient(objSocket: WebSocket, objMessage: IWebSocketMessage): void {
  try {
    objSocket.send(JSON.stringify(objMessage));
  } catch {
    // Socket may have closed between check and send
    objSocket.close();
  }
}

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

export function broadcastDeviceOnline(strDeviceId: string): void {
  const objMessage: IWebSocketMessage = {
    type: 'device-online',
    deviceId: strDeviceId,
  };

  for (const objClient of setClients) {
    if (objClient.readyState === WS_OPEN) {
      sendToClient(objClient, objMessage);
    }
  }
}

export function broadcastDeviceOffline(strDeviceId: string): void {
  const objMessage: IWebSocketMessage = {
    type: 'device-offline',
    deviceId: strDeviceId,
  };

  for (const objClient of setClients) {
    if (objClient.readyState === WS_OPEN) {
      sendToClient(objClient, objMessage);
    }
  }
}

export function startHeartbeatMonitor(): NodeJS.Timeout {
  const fnCheck = (): void => {
    const nNow = Date.now();
    for (const strDeviceId of setOnlineDevices) {
      const nLastSeen = mapLastSeen.get(strDeviceId) ?? 0;
      if (nNow - nLastSeen >= objConfig.nDeviceOfflineThresholdMs) {
        setOnlineDevices.delete(strDeviceId);
        broadcastDeviceOffline(strDeviceId);
      }
    }
  };

  return setInterval(fnCheck, objConfig.nHeartbeatCheckMs);
}

export async function registerStreamRoute(objApp: FastifyInstance): Promise<void> {
  objApp.get('/stream', { websocket: true, preHandler: authenticate }, (objSocket, objReq) => {
    const objQuery = (objReq.query ?? {}) as Record<string, string | undefined>;
    const strDeviceId = objQuery.deviceId;

    setClients.add(objSocket);

    // Send init payload
    if (strDeviceId) {
      const arrMetrics = getMetricsRaw(strDeviceId, 0, Date.now(), objConfig.nInitMetricsLimit);
      // Rehydrate into full payload shape from stored columns
      const arrPayloads: IMetricPayload[] = arrMetrics.map((objRow) => ({
        deviceId: objRow.deviceId,
        timestamp: objRow.timestamp,
        cpu: {
          usage: objRow.cpuUsage,
          user: objRow.cpuUser,
          system: objRow.cpuSystem,
          idle: objRow.cpuIdle,
        },
        memory: {
          total: objRow.memTotalMb,
          used: objRow.memUsedMb,
          free: objRow.memFreeMb,
          percent: objRow.memPercent,
        },
        load: [objRow.load1m, objRow.load5m, objRow.load15m],
      }));

      sendToClient(objSocket, {
        type: 'init',
        deviceId: strDeviceId,
        metrics: arrPayloads.reverse(),
      });
    }

    objSocket.on('close', () => {
      setClients.delete(objSocket);
    });

    objSocket.on('error', (objErr: Error) => {
      objApp.log.warn({ err: objErr }, 'WebSocket error');
      setClients.delete(objSocket);
    });
  });
}
