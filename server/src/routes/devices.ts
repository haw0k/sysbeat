import { FastifyInstance } from 'fastify';
import { objConfig } from '../config.js';
import { getDevices } from '../store/metrics-store.js';
import { getLastSeenMap } from '../websocket/stream.js';
import { authenticate } from './auth.js';
import type { IDeviceInfo } from '../types/index.js';

export async function registerDevicesRoute(objApp: FastifyInstance): Promise<void> {
  objApp.get('/devices', { preHandler: authenticate }, async () => {
    const arrDbDevices = getDevices();
    const mapLastSeen = getLastSeenMap();
    const nNow = Date.now();

    const arrDevices: IDeviceInfo[] = arrDbDevices.map((objDevice) => {
      const nLastSeen = mapLastSeen.get(objDevice.deviceId) ?? objDevice.lastSeen ?? 0;
      const bIsOnline = nNow - nLastSeen < objConfig.nDeviceOfflineThresholdMs;

      return {
        deviceId: objDevice.deviceId,
        lastSeen: nLastSeen,
        isOnline: bIsOnline,
      };
    });

    return arrDevices;
  });
}
