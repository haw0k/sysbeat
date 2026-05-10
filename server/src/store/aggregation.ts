import { getDb } from './db.js';
import type { IAggregationBucket } from '../types/index.js';

let stmtHourly: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let stmtDaily: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let stmtUpsertHourly: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let stmtPrecomputeRange: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let bInitialized = false;

function ensureInitialized(): void {
  if (bInitialized) return;
  const db = getDb();

  stmtHourly = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00', timestamp / 1000, 'unixepoch') as bucket,
      ROUND(AVG(cpu_usage), 1) as avgCpu,
      ROUND(MAX(cpu_usage), 1) as maxCpu,
      ROUND(AVG(mem_percent), 1) as avgMem,
      ROUND(MAX(mem_percent), 1) as maxMem,
      COUNT(*) as samples
    FROM metrics
    WHERE device_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY bucket
    ORDER BY bucket
  `);

  stmtDaily = db.prepare(`
    SELECT
      strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') as bucket,
      ROUND(AVG(cpu_usage), 1) as avgCpu,
      ROUND(MAX(cpu_usage), 1) as maxCpu,
      ROUND(AVG(mem_percent), 1) as avgMem,
      ROUND(MAX(mem_percent), 1) as maxMem,
      COUNT(*) as samples
    FROM metrics
    WHERE device_id = ? AND timestamp BETWEEN ? AND ?
    GROUP BY bucket
    ORDER BY bucket
  `);

  stmtUpsertHourly = db.prepare(`
    INSERT INTO hourly_stats (device_id, hour, avg_cpu, max_cpu, avg_mem, max_mem, samples)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, hour) DO UPDATE SET
      avg_cpu = excluded.avg_cpu,
      max_cpu = excluded.max_cpu,
      avg_mem = excluded.avg_mem,
      max_mem = excluded.max_mem,
      samples = excluded.samples
  `);

  stmtPrecomputeRange = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00', timestamp / 1000, 'unixepoch') as bucket,
      ROUND(AVG(cpu_usage), 1) as avgCpu,
      ROUND(MAX(cpu_usage), 1) as maxCpu,
      ROUND(AVG(mem_percent), 1) as avgMem,
      ROUND(MAX(mem_percent), 1) as maxMem,
      COUNT(*) as samples
    FROM metrics
    WHERE device_id = ? AND timestamp >= ? AND timestamp < ?
    GROUP BY bucket
    ORDER BY bucket
  `);

  bInitialized = true;
}

export function getHourlyAggregation(
  strDeviceId: string,
  nFrom: number,
  nTo: number
): IAggregationBucket[] {
  ensureInitialized();
  return stmtHourly!.all(strDeviceId, nFrom, nTo) as IAggregationBucket[];
}

export function getDailyAggregation(
  strDeviceId: string,
  nFrom: number,
  nTo: number
): IAggregationBucket[] {
  ensureInitialized();
  return stmtDaily!.all(strDeviceId, nFrom, nTo) as IAggregationBucket[];
}

export function precomputeHourlyStats(
  strDeviceId: string,
  nHourStart: number,
  nHourEnd: number
): void {
  ensureInitialized();
  const arrBuckets = stmtPrecomputeRange!.all(strDeviceId, nHourStart, nHourEnd) as Array<{
    bucket: string;
    avgCpu: number;
    maxCpu: number;
    avgMem: number;
    maxMem: number;
    samples: number;
  }>;

  for (const objBucket of arrBuckets) {
    stmtUpsertHourly!.run(
      strDeviceId,
      objBucket.bucket,
      objBucket.avgCpu,
      objBucket.maxCpu,
      objBucket.avgMem,
      objBucket.maxMem,
      objBucket.samples
    );
  }
}
