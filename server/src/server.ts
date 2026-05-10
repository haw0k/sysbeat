import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { objConfig } from './config.js';
import { closeDb } from './store/db.js';
import { startRetentionJob } from './store/retention.js';
import { precomputeHourlyStats } from './store/aggregation.js';
import { getDevices } from './store/metrics-store.js';
import { registerIngestRoute } from './routes/ingest.js';
import { registerHealthRoute } from './routes/health.js';
import { registerDevicesRoute } from './routes/devices.js';
import { registerMetricsRoute } from './routes/metrics.js';
import { registerStreamRoute, startHeartbeatMonitor } from './websocket/stream.js';

const objApp = Fastify({
  logger: {
    level: objConfig.strNodeEnv === 'development' ? 'debug' : 'info',
    transport:
      objConfig.strNodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

async function startServer(): Promise<void> {
  await objApp.register(cors, {
    origin: objConfig.strCorsOrigin,
    credentials: true,
  });

  await objApp.register(websocket);

  await registerIngestRoute(objApp);
  await registerHealthRoute(objApp);
  await registerDevicesRoute(objApp);
  await registerMetricsRoute(objApp);
  await registerStreamRoute(objApp);

  // Background jobs
  const timerRetention = startRetentionJob(objApp.log);
  const timerHeartbeat = startHeartbeatMonitor();

  const fnPrecomputeAll = (): void => {
    try {
      const nHourAgo = Date.now() - 60 * 60 * 1000;
      const nNow = Date.now();
      const arrDevices = getDevices();
      for (const objDevice of arrDevices) {
        precomputeHourlyStats(objDevice.deviceId, nHourAgo, nNow);
      }
    } catch (objErr) {
      objApp.log.error(objErr, 'Precompute job failed');
    }
  };

  // Run precompute immediately, then every 10 minutes
  fnPrecomputeAll();
  const timerPrecompute = setInterval(fnPrecomputeAll, objConfig.nPrecomputeIntervalMs);

  // Graceful shutdown
  const fnShutdown = async (strSignal: string): Promise<void> => {
    objApp.log.info(`Received ${strSignal}, shutting down gracefully...`);

    clearInterval(timerRetention);
    clearInterval(timerHeartbeat);
    clearInterval(timerPrecompute);

    try {
      await objApp.close();
      closeDb();
      objApp.log.info('Server shut down.');
    } catch (objErr) {
      objApp.log.error(objErr, 'Error during shutdown');
    }
  };

  process.on('SIGINT', () => void fnShutdown('SIGINT'));
  process.on('SIGTERM', () => void fnShutdown('SIGTERM'));

  try {
    const strHost = await objApp.listen({ port: objConfig.nPort, host: '0.0.0.0' });
    objApp.log.info(`Server listening on ${strHost}`);
  } catch (objErr) {
    objApp.log.error(objErr);
    process.exit(1);
  }
}

void startServer();
