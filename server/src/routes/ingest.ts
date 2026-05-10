import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { objConfig } from '../config.js';
import { authenticateIngest } from './auth.js';
import { insertMetric } from '../store/metrics-store.js';
import { broadcastUpdate, broadcastDeviceOnline, markDeviceSeen } from '../websocket/stream.js';
import type { IMetricPayload, IRateLimitEntry } from '../types/index.js';

const objIngestSchema = z.object({
  deviceId: z.string().min(1),
  timestamp: z.number().int().positive(),
  cpu: z.object({
    usage: z.number().min(0).max(100),
    user: z.number().min(0).max(100),
    system: z.number().min(0).max(100),
    idle: z.number().min(0).max(100),
  }),
  memory: z.object({
    total: z.number().positive(),
    used: z.number().nonnegative(),
    free: z.number().nonnegative(),
    percent: z.number().min(0).max(100),
  }),
  load: z.tuple([z.number(), z.number(), z.number()]),
});

const mapRateLimits = new Map<string, IRateLimitEntry>();

const timerRateLimitCleanup = setInterval(() => {
  const nNow = Date.now();
  for (const [strKey, objEntry] of mapRateLimits.entries()) {
    if (nNow > objEntry.nResetTime) {
      mapRateLimits.delete(strKey);
    }
  }
}, 60_000);
if (timerRateLimitCleanup.unref) timerRateLimitCleanup.unref();

function checkRateLimit(strDeviceId: string): boolean {
  const nNow = Date.now();

  const objEntry = mapRateLimits.get(strDeviceId);

  if (!objEntry || nNow > objEntry.nResetTime) {
    mapRateLimits.set(strDeviceId, { nCount: 1, nResetTime: nNow + objConfig.nRateLimitWindowMs });
    return true;
  }

  if (objEntry.nCount >= objConfig.nRateLimitMax) {
    return false;
  }

  objEntry.nCount += 1;
  return true;
}

export async function registerIngestRoute(objApp: FastifyInstance): Promise<void> {
  objApp.post('/ingest', { preHandler: authenticateIngest }, async (objRequest, objReply) => {
    const objParsed = objIngestSchema.safeParse(objRequest.body);
    if (!objParsed.success) {
      return objReply.status(400).send({ error: 'Validation failed', details: objParsed.error.format() });
    }

    // Clone to avoid mutating the Zod-validated object
    const objMetric: IMetricPayload = { ...objParsed.data };

    if (!checkRateLimit(objMetric.deviceId)) {
      return objReply.status(429).send({ error: 'Rate limit exceeded' });
    }

    // Normalize timestamp to ms if it looks like seconds (before year 2033 in ms)
    if (objMetric.timestamp < 2_000_000_000_000) {
      objMetric.timestamp *= 1000;
    }

    const bWasKnown = markDeviceSeen(objMetric.deviceId);
    insertMetric(objMetric);

    if (!bWasKnown) {
      setImmediate(() => broadcastDeviceOnline(objMetric.deviceId));
    }

    setImmediate(() => broadcastUpdate(objMetric));

    return { success: true };
  });
}
