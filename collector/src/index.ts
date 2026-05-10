import { objConfig } from './config.js';
import { readProcStat, readProcMeminfo, readProcLoadavg } from './parser.js';
import { sendMetrics } from './sender.js';
import type { IMetricPayload } from './types.js';

let bRunning = true;
let bSending = false;
let timerTimeout: NodeJS.Timeout | null = null;
let bIsFirstRun = true;

function formatLog(objMetric: IMetricPayload, nStatusCode: number | null, strExtra?: string): string {
  const strNow = new Date().toISOString();
  const strCpu = `${objMetric.cpu.usage}%`;
  const strMem = `${objMetric.memory.percent}%`;
  const strLoad = objMetric.load[0].toFixed(2);
  const strStatus = strExtra || (nStatusCode !== null ? String(nStatusCode) : 'pending');
  const strFirstRun = bIsFirstRun ? ' (first run)' : '';

  return `[${strNow}] cpu: ${strCpu} mem: ${strMem} load: ${strLoad} status: ${strStatus}${strFirstRun}`;
}

async function collectAndSend(): Promise<void> {
  // Guard against overlapping calls — skip if previous send is still in flight
  if (bSending || !bRunning) return;

  bSending = true;

  try {
    const objCpu = readProcStat();
    const objMem = readProcMeminfo();
    const arrLoad = readProcLoadavg();

    const nMemPercent = objMem.nTotalMb > 0
      ? Math.round((objMem.nUsedMb / objMem.nTotalMb) * 1000) / 10
      : 0;

    const objPayload: IMetricPayload = {
      deviceId: objConfig.strDeviceId,
      timestamp: Date.now(),
      cpu: {
        usage: objCpu.nUsage,
        user: objCpu.nUser,
        system: objCpu.nSystem,
        idle: objCpu.nIdle,
      },
      memory: {
        total: objMem.nTotalMb,
        used: objMem.nUsedMb,
        free: objMem.nFreeMb,
        percent: nMemPercent,
      },
      load: arrLoad,
    };

    const objResult = await sendMetrics(objPayload);

    if (objResult.bSuccess) {
      console.log(formatLog(objPayload, objResult.nStatusCode));
    } else {
      console.log(formatLog(objPayload, objResult.nStatusCode, 'failed'));
    }
  } catch (objErr) {
    const strError = objErr instanceof Error ? objErr.message : String(objErr);
    const strNow = new Date().toISOString();
    console.error(`[${strNow}] collect error: ${strError}`);
  } finally {
    bSending = false;
    bIsFirstRun = false;

    // Schedule next run with recursive setTimeout to avoid interval overlap
    if (bRunning) {
      timerTimeout = setTimeout(collectAndSend, objConfig.nIntervalMs);
    }
  }
}

async function gracefulShutdown(): Promise<void> {
  bRunning = false;

  if (timerTimeout) {
    clearTimeout(timerTimeout);
    timerTimeout = null;
  }

  console.log('\nShutting down gracefully...');

  // Wait for current send to complete (up to 10 seconds)
  let nWaited = 0;
  while (bSending && nWaited < 10000) {
    await new Promise((fnResolve) => setTimeout(fnResolve, 100));
    nWaited += 100;
  }

  if (bSending) {
    console.warn('Forced exit: send did not complete in time');
  }

  console.log('Goodbye.');
}

process.on('SIGINT', () => void gracefulShutdown());
process.on('SIGTERM', () => void gracefulShutdown());

// Start
console.log(`sysbeat-collector starting...`);
console.log(`device: ${objConfig.strDeviceId}`);
console.log(`server: ${objConfig.strServerUrl}`);
console.log(`interval: ${objConfig.nIntervalMs}ms\n`);

// Kick off the first collection; it schedules itself recursively
collectAndSend();
