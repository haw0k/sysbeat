import { getDb } from './db.js';
import type { IMetricPayload } from '../types/index.js';

const db = getDb();

const stmtInsert = db.prepare(`
  INSERT INTO metrics
    (device_id, timestamp, cpu_usage, cpu_user, cpu_system, mem_percent, mem_used_mb, load_1m, load_5m, load_15m)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetRaw = db.prepare(`
  SELECT
    device_id as deviceId,
    timestamp,
    cpu_usage as cpuUsage,
    cpu_user as cpuUser,
    cpu_system as cpuSystem,
    mem_percent as memPercent,
    mem_used_mb as memUsedMb,
    load_1m as load1m,
    load_5m as load5m,
    load_15m as load15m
  FROM metrics
  WHERE device_id = ? AND timestamp BETWEEN ? AND ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const stmtGetDevices = db.prepare(`
  SELECT DISTINCT device_id as deviceId, MAX(timestamp) as lastSeen
  FROM metrics
  GROUP BY device_id
`);

const stmtLastIngest = db.prepare(`
  SELECT MAX(timestamp) as lastIngest
  FROM metrics
`);

export function insertMetric(objMetric: IMetricPayload): void {
  stmtInsert.run(
    objMetric.deviceId,
    objMetric.timestamp,
    objMetric.cpu.usage,
    objMetric.cpu.user,
    objMetric.cpu.system,
    objMetric.memory.percent,
    objMetric.memory.used,
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
  memPercent: number;
  memUsedMb: number;
  load1m: number;
  load5m: number;
  load15m: number;
}> {
  return stmtGetRaw.all(strDeviceId, nFrom, nTo, nLimit) as ReturnType<typeof getMetricsRaw>;
}

export function getDevices(): Array<{ deviceId: string; lastSeen: number }> {
  return stmtGetDevices.all() as ReturnType<typeof getDevices>;
}

export function getLastIngestTime(): number | null {
  const objRow = stmtLastIngest.get() as { lastIngest: number | null } | undefined;
  return objRow?.lastIngest ?? null;
}
