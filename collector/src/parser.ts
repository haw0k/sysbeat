import { readFileSync } from 'fs';

interface IProcMeminfo {
  nTotalMb: number;
  nUsedMb: number;
  nFreeMb: number;
  nAvailableMb: number;
}

// Previous CPU values for delta calculation
let nPrevUser = 0;
let nPrevSystem = 0;
let nPrevIdle = 0;
let nPrevIowait = 0;
let nPrevTotal = 0;
let bFirstRun = true;

/**
 * Parse /proc/stat for CPU metrics.
 * Returns usage percentage based on delta from previous call.
 * If /proc/stat is unreadable, returns zeros and preserves previous state.
 */
export function readProcStat(): { nUsage: number; nUser: number; nSystem: number; nIdle: number } {
  let strContent: string;
  try {
    strContent = readFileSync('/proc/stat', 'utf-8');
  } catch (objErr) {
    const strMsg = objErr instanceof Error ? objErr.message : String(objErr);
    console.error(`[${new Date().toISOString()}] readProcStat error: ${strMsg} (is /proc mounted and accessible?)`);
    return { nUsage: 0, nUser: 0, nSystem: 0, nIdle: 100 };
  }

  const strCpuLine = strContent.split('\n').find((strLine) => strLine.startsWith('cpu '));

  if (!strCpuLine) {
    console.error(`[${new Date().toISOString()}] readProcStat error: cpu line not found`);
    return { nUsage: 0, nUser: 0, nSystem: 0, nIdle: 100 };
  }

  const arrFields = strCpuLine.trim().split(/\s+/).slice(1).map(Number);
  // Fields: user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice
  const nUser = arrFields[0] || 0;
  const nNice = arrFields[1] || 0;
  const nSystem = arrFields[2] || 0;
  const nIdle = arrFields[3] || 0;
  const nIowait = arrFields[4] || 0;
  const nIrq = arrFields[5] || 0;
  const nSoftirq = arrFields[6] || 0;
  const nSteal = arrFields[7] || 0;

  const nTotal = nUser + nNice + nSystem + nIdle + nIowait + nIrq + nSoftirq + nSteal;

  if (bFirstRun) {
    bFirstRun = false;
    nPrevUser = nUser;
    nPrevSystem = nSystem;
    nPrevIdle = nIdle;
    nPrevIowait = nIowait;
    nPrevTotal = nTotal;
    return { nUsage: 0, nUser: 0, nSystem: 0, nIdle: 100 };
  }

  const nDeltaTotal = nTotal - nPrevTotal;
  if (nDeltaTotal === 0) {
    return { nUsage: 0, nUser: 0, nSystem: 0, nIdle: 100 };
  }

  // Calculate percentages from deltas
  // Active = total - idle - iowait (matches top/htop behavior)
  const nDeltaUser = nUser - nPrevUser;
  const nDeltaSystem = nSystem - nPrevSystem;
  const nDeltaIdle = nIdle - nPrevIdle;
  const nDeltaIowait = nIowait - nPrevIowait;

  const nUsage = 100 * (nDeltaTotal - nDeltaIdle - nDeltaIowait) / nDeltaTotal;
  const nIdlePct = 100 * nDeltaIdle / nDeltaTotal;
  const nUserPct = 100 * nDeltaUser / nDeltaTotal;
  const nSystemPct = 100 * nDeltaSystem / nDeltaTotal;

  // Update previous values
  nPrevUser = nUser;
  nPrevSystem = nSystem;
  nPrevIdle = nIdle;
  nPrevIowait = nIowait;
  nPrevTotal = nTotal;

  return {
    nUsage: Math.min(100, Math.round(nUsage * 10) / 10),
    nUser: Math.min(100, Math.round(nUserPct * 10) / 10),
    nSystem: Math.min(100, Math.round(nSystemPct * 10) / 10),
    nIdle: Math.min(100, Math.round(nIdlePct * 10) / 10),
  };
}

/**
 * Parse /proc/meminfo for memory metrics.
 * All values in /proc/meminfo are in kB, we convert to MB.
 * Tolerates variations in unit formatting (kB, KB, kb, etc.).
 */
export function readProcMeminfo(): IProcMeminfo {
  let strContent: string;
  try {
    strContent = readFileSync('/proc/meminfo', 'utf-8');
  } catch (objErr) {
    const strMsg = objErr instanceof Error ? objErr.message : String(objErr);
    console.error(`[${new Date().toISOString()}] readProcMeminfo error: ${strMsg} (is /proc mounted and accessible?)`);
    return { nTotalMb: 0, nUsedMb: 0, nFreeMb: 0, nAvailableMb: 0 };
  }

  const mapValues = new Map<string, number>();

  for (const strLine of strContent.split('\n')) {
    // Tolerant regex: handles kB, KB, kb, etc.
    const arrMatch = strLine.match(/^([\w()]+):\s+(\d+)\s+\w*?[bB]\s*$/i);
    if (arrMatch) {
      mapValues.set(arrMatch[1], Number(arrMatch[2]));
    }
  }

  const nTotalKb = mapValues.get('MemTotal') || 0;
  const nAvailableKb = mapValues.get('MemAvailable') || 0;
  const nFreeKb = mapValues.get('MemFree') || 0;
  const nBuffersKb = mapValues.get('Buffers') || 0;
  const nCachedKb = mapValues.get('Cached') || 0;

  // Use MemAvailable if present (Linux 3.14+), otherwise estimate
  const nAvailableForUseKb = nAvailableKb > 0
    ? nAvailableKb
    : nFreeKb + nBuffersKb + nCachedKb;

  const nTotalMb = Math.round(nTotalKb / 1024);
  const nFreeMb = Math.round(nFreeKb / 1024);
  const nAvailableMb = Math.round(nAvailableForUseKb / 1024);
  const nUsedMb = Math.max(0, nTotalMb - nAvailableMb);

  return {
    nTotalMb,
    nUsedMb,
    nFreeMb,
    nAvailableMb,
  };
}

/**
 * Parse /proc/loadavg for load averages.
 * Returns [0, 0, 0] if file is unreadable or malformed.
 */
export function readProcLoadavg(): [number, number, number] {
  let strContent: string;
  try {
    strContent = readFileSync('/proc/loadavg', 'utf-8');
  } catch (objErr) {
    const strMsg = objErr instanceof Error ? objErr.message : String(objErr);
    console.error(`[${new Date().toISOString()}] readProcLoadavg error: ${strMsg} (is /proc mounted and accessible?)`);
    return [0, 0, 0];
  }

  const arrParts = strContent.trim().split(/\s+/);
  const n1m = Number(arrParts[0]);
  const n5m = Number(arrParts[1]);
  const n15m = Number(arrParts[2]);

  if (!Number.isFinite(n1m) || !Number.isFinite(n5m) || !Number.isFinite(n15m)) {
    console.error(`[${new Date().toISOString()}] readProcLoadavg error: malformed content`);
    return [0, 0, 0];
  }

  return [n1m, n5m, n15m];
}
