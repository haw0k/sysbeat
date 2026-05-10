import { FastifyInstance } from 'fastify';
import { statSync } from 'fs';
import { objConfig } from '../config.js';
import { getDevices, getLastIngestTime } from '../store/metrics-store.js';
import type { IHealthResponse } from '../types/index.js';

export async function registerHealthRoute(objApp: FastifyInstance): Promise<void> {
  objApp.get('/health', async () => {
    let nDbSizeBytes = 0;
    try {
      const objStats = statSync(objConfig.strDbPath);
      nDbSizeBytes = objStats.size;
    } catch {
      // File may not exist yet
    }

    const arrDevices = getDevices();
    const nLastIngest = getLastIngestTime();

    const objResponse: IHealthResponse = {
      status: 'ok',
      uptime: process.uptime(),
      dbSizeBytes: nDbSizeBytes,
      deviceCount: arrDevices.length,
      lastIngestTimestamp: nLastIngest,
    };

    return objResponse;
  });
}
