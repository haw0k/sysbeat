import { getDb } from './db.js';
import { objConfig } from '../config.js';

const db = getDb();

const stmtPurgeMetrics = db.prepare(`
  DELETE FROM metrics
  WHERE timestamp < (strftime('%s', 'now', '-${objConfig.nRetentionDays} days') * 1000)
`);

const stmtPurgeHourly = db.prepare(`
  DELETE FROM hourly_stats
  WHERE hour < strftime('%Y-%m-%dT%H:00', 'now', '-${objConfig.nRetentionDays} days')
`);

const stmtVacuum = db.prepare('VACUUM');

export function purgeOldMetrics(): number {
  const objInfo = stmtPurgeMetrics.run();
  return objInfo.changes;
}

export function purgeOrphanedHourlyStats(): number {
  const objInfo = stmtPurgeHourly.run();
  return objInfo.changes;
}

export function vacuumDb(): void {
  stmtVacuum.run();
}

export function startRetentionJob(): NodeJS.Timeout {
  const fnRun = (): void => {
    const nDeletedMetrics = purgeOldMetrics();
    const nDeletedHourly = purgeOrphanedHourlyStats();
    if (nDeletedMetrics > 0 || nDeletedHourly > 0) {
      vacuumDb();
    }
  };

  // Run immediately on startup, then periodically
  fnRun();
  return setInterval(fnRun, objConfig.nRetentionIntervalMs);
}
