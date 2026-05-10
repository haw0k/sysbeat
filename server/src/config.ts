import dotenv from 'dotenv';
import { z } from 'zod';
import { resolve } from 'path';

dotenv.config();

const objEnvSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  DB_PATH: z.string().default('./data/sysbeat.db'),
  INGEST_TOKEN: z.string().min(1, 'INGEST_TOKEN is required'),
  CORS_ORIGIN: z.string().default('*'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const objParsed = objEnvSchema.safeParse(process.env);

if (!objParsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', objParsed.error.format());
  process.exit(1);
}

export const objConfig = {
  nPort: objParsed.data.PORT,
  strDbPath: resolve(objParsed.data.DB_PATH),
  strIngestToken: objParsed.data.INGEST_TOKEN,
  strCorsOrigin: objParsed.data.CORS_ORIGIN,
  strNodeEnv: objParsed.data.NODE_ENV,
  nRetentionDays: 7,
  nRateLimitWindowMs: 60_000,
  nRateLimitMax: 100,
  nDeviceOfflineThresholdMs: 30_000,
  nRetentionIntervalMs: 60 * 60 * 1000, // 1 hour
  nPrecomputeIntervalMs: 10 * 60 * 1000, // 10 minutes
  nHeartbeatCheckMs: 5_000, // 5 seconds
  nInitMetricsLimit: 100,
} as const;
