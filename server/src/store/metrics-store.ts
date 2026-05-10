import { getDb } from './db.js';
import type { IMetricPayload } from '../types/index.js';

let stmtInsert: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let stmtGetRaw: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let stmtGetDevices: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let stmtLastIngest: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let bInitialized = false;

function ensureInitialized(): void {
  if (bInitialized) return;
  const db = getDb();

  stmtInsert = db.prepare(`
    INSERT INTO metrics
      (device_id, timestamp, cpu_usage, cpu_user, cpu_system, cpu_idle,
       mem_percent, mem_total_mb, mem_used_mb, mem_free_mb,
       load_1m, load_5m, load_15m)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmtGetRaw = db.prepare(`
    SELECT
      device_id as deviceId,
      timestamp,
      cpu_usage as cpuUsage,
      cpu_user as cpuUser,
      cpu_system as cpuSystem,
      cpu_idle as cpuIdle,
      mem_percent as memPercent,
      mem_total_mb as memTotalMb,
      mem_used_mb as memUsedMb,
      mem_free_mb as memFreeMb,
      load_1m as load1m,
      load_5m as load5m,
      load_15m as load15m
    FROM metrics
    WHERE device_id = ? AND timestamp BETWEEN ? AND ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  stmtGetDevices = db.prepare(`
    SELECT DISTINCT device_id as deviceId, MAX(timestamp) as lastSeen
    FROM metrics
    GROUP BY device_id
  `);

  stmtLastIngest = db.prepare(`
    SELECT MAX(timestamp) as lastIngest
    FROM metrics
  `);

  bInitialized = true;
}

export function insertMetric(objMetric: IMetricPayload): void {
  ensureInitialized();
  stmtInsert!.run(
    objMetric.deviceId,
    objMetric.timestamp,
    objMetric.cpu.usage,
    objMetric.cpu.user,
    objMetric.cpu.system,
    objMetric.cpu.idle,
    objMetric.memory.percent,
    objMetric.memory.total,
    objMetric.memory.used,
    objMetric.memory.free,
    objMetric.load[0],
    objMetric.load[1],
    objMetric.load[2]
  );
}

export function getMetricsRaw(
  strDeviceId: string,
  nFrom: number,
  nTo: number,
  nLimit: number
): Array<{
  deviceId: string;
  timestamp: number;
  cpuUsage: number;
  cpuUser: number;
  cpuSystem: number;
  cpuIdle: number;
  memPercent: number;
  memTotalMb: number;
  memUsedMb: number;
  memFreeMb: number;
  load1m: number;
  load5m: number;
  load15m: number;
}> {
  ensureInitialized();
  return stmtGetRaw!.all(strDeviceId, nFrom, nTo, nLimit) as ReturnType<typeof getMetricsRaw>;
}

export function getDevices(): Array<{ deviceId: string; lastSeen: number }> {
  ensureInitialized();
  return stmtGetDevices!.all() as ReturnType<typeof getDevices>;
}

export function getLastIngestTime(): number | null {
  ensureInitialized();
  const objRow = stmtLastIngest!.get() as { lastIngest: number | null } | undefined;
  return objRow?.lastIngest ?? null;
}
