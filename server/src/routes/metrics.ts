import { FastifyInstance } from 'fastify';
import { getMetricsRaw } from '../store/metrics-store.js';
import { getHourlyAggregation, getDailyAggregation } from '../store/aggregation.js';
import { authenticate } from './auth.js';
import type { IMetricPayload } from '../types/index.js';

function rehydrateMetrics(arrRows: ReturnType<typeof getMetricsRaw>): IMetricPayload[] {
  return arrRows.map((objRow) => ({
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
}

export async function registerMetricsRoute(objApp: FastifyInstance): Promise<void> {
  objApp.get('/api/metrics/:deviceId', { preHandler: authenticate }, async (objRequest, objReply) => {
    const strDeviceId = (objRequest.params as Record<string, string>).deviceId;
    const objQuery = objRequest.query as Record<string, string | undefined>;

    const nFrom = objQuery.from ? Number(objQuery.from) : 0;
    const nTo = objQuery.to ? Number(objQuery.to) : Date.now();
    const strResolution = (objQuery.resolution ?? 'raw') as 'raw' | 'hourly' | 'daily';

    if (!strDeviceId) {
      return objReply.status(400).send({ error: 'deviceId is required' });
    }

    switch (strResolution) {
      case 'hourly': {
        const arrHourly = getHourlyAggregation(strDeviceId, nFrom, nTo);
        return { deviceId: strDeviceId, resolution: 'hourly', data: arrHourly };
      }
      case 'daily': {
        const arrDaily = getDailyAggregation(strDeviceId, nFrom, nTo);
        return { deviceId: strDeviceId, resolution: 'daily', data: arrDaily };
      }
      case 'raw':
      default: {
        const arrRaw = getMetricsRaw(strDeviceId, nFrom, nTo, 10_000);
        const arrPayloads = rehydrateMetrics(arrRaw);
        return { deviceId: strDeviceId, resolution: 'raw', data: arrPayloads.reverse() };
      }
    }
  });
}
