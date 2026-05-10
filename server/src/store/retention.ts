import type { FastifyBaseLogger } from 'fastify';
import { getDb } from './db.js';
import { objConfig } from '../config.js';

let stmtPurgeMetrics: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let stmtPurgeHourly: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;
let bInitialized = false;

function ensureInitialized(): void {
  if (bInitialized) return;
  const db = getDb();

  stmtPurgeMetrics = db.prepare(`
    DELETE FROM metrics
    WHERE timestamp < ?
  `);

  stmtPurgeHourly = db.prepare(`
    DELETE FROM hourly_stats
    WHERE hour < ?
  `);

  bInitialized = true;
}

function getRetentionCutoffTimestamp(): number {
  return Date.now() - objConfig.nRetentionDays * 24 * 60 * 60 * 1000;
}

function getRetentionCutoffHour(): string {
  const nCutoff = new Date(Date.now() - objConfig.nRetentionDays * 24 * 60 * 60 * 1000);
  const strYear = String(nCutoff.getUTCFullYear());
  const strMonth = String(nCutoff.getUTCMonth() + 1).padStart(2, '0');
  const strDay = String(nCutoff.getUTCDate()).padStart(2, '0');
  const strHour = String(nCutoff.getUTCHours()).padStart(2, '0');
  return `${strYear}-${strMonth}-${strDay}T${strHour}:00`;
}

export function purgeOldMetrics(): number {
  ensureInitialized();
  const objInfo = stmtPurgeMetrics!.run(getRetentionCutoffTimestamp());
  return objInfo.changes;
}

export function purgeOrphanedHourlyStats(): number {
  ensureInitialized();
  const objInfo = stmtPurgeHourly!.run(getRetentionCutoffHour());
  return objInfo.changes;
}

export function startRetentionJob(objLogger: FastifyBaseLogger): NodeJS.Timeout {
  const db = getDb();

  const fnRun = (): void => {
    try {
      const nDeletedMetrics = purgeOldMetrics();
      const nDeletedHourly = purgeOrphanedHourlyStats();

      // Free unused pages in small batches; no-op if auto_vacuum != INCREMENTAL
      if (nDeletedMetrics > 1000 || nDeletedHourly > 1000) {
        db.pragma('incremental_vacuum(100)');
      }
    } catch (objErr) {
      objLogger.error(objErr, 'Retention job failed');
    }
  };

  // Run immediately on startup, then periodically
  fnRun();
  return setInterval(fnRun, objConfig.nRetentionIntervalMs);
}
