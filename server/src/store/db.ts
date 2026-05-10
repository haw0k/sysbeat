import Database from 'better-sqlite3';
import { objConfig } from '../config.js';

let dbConnection: Database | null = null;

export function getDb(): Database {
  if (!dbConnection) {
    dbConnection = new Database(objConfig.strDbPath);
    dbConnection.pragma('journal_mode = WAL');
    runMigrations(dbConnection);
  }
  return dbConnection;
}

export function closeDb(): void {
  if (dbConnection) {
    dbConnection.close();
    dbConnection = null;
  }
}

function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cpu_usage REAL,
      cpu_user REAL,
      cpu_system REAL,
      mem_percent REAL,
      mem_used_mb INTEGER,
      load_1m REAL,
      load_5m REAL,
      load_15m REAL
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_time
      ON metrics(device_id, timestamp);

    CREATE TABLE IF NOT EXISTS hourly_stats (
      device_id TEXT,
      hour TEXT,
      avg_cpu REAL,
      max_cpu REAL,
      avg_mem REAL,
      max_mem REAL,
      samples INTEGER,
      PRIMARY KEY (device_id, hour)
    );

    CREATE INDEX IF NOT EXISTS idx_hourly
      ON hourly_stats(device_id, hour);
  `);
}
