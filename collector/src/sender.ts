import { request, Agent as HttpsAgent } from 'https';
import { request as requestHttp, Agent as HttpAgent } from 'http';
import { URL } from 'url';
import { objConfig } from './config.js';
import type { IMetricPayload } from './types.js';

interface ISendResult {
  bSuccess: boolean;
  nStatusCode: number;
  strError?: string;
}

// Reuse TCP connections across requests to avoid opening a new one every second
const objHttpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 1 });
const objHttpAgent = new HttpAgent({ keepAlive: true, maxSockets: 1 });

/**
 * Send metrics to server with retry logic.
 * Retries only on network errors or 5xx. Does not retry 4xx client errors (except 408).
 * Exponential backoff: 1s, 2s, 4s, 8s, max 30s.
 */
export async function sendMetrics(objPayload: IMetricPayload): Promise<ISendResult> {
  const nMaxBackoffMs = 30000;
  let nBackoffMs = 1000;
  let nAttempt = 0;

  while (true) {
    nAttempt++;
    const objResult = await trySend(objPayload);

    // Do not retry on client errors (except 408 Request Timeout)
    if (objResult.nStatusCode >= 400 && objResult.nStatusCode < 500 && objResult.nStatusCode !== 408) {
      return objResult;
    }

    if (objResult.bSuccess) {
      return objResult;
    }

    if (nAttempt >= 10) {
      return { bSuccess: false, nStatusCode: objResult.nStatusCode, strError: 'Max retries exceeded' };
    }

    // Exponential backoff with jitter
    const nJitter = Math.random() * 200;
    const nWait = Math.min(nBackoffMs + nJitter, nMaxBackoffMs);

    logRetry(nAttempt, nWait, objResult.strError);
    await sleep(nWait);

    nBackoffMs = Math.min(nBackoffMs * 2, nMaxBackoffMs);
  }
}

function trySend(objPayload: IMetricPayload): Promise<ISendResult> {
  return new Promise((fnResolve) => {
    let bResolved = false;

    function resolveOnce(objResult: ISendResult): void {
      if (!bResolved) {
        bResolved = true;
        fnResolve(objResult);
      }
    }

    const strUrl = objConfig.strServerUrl;
    const objUrl = new URL(strUrl);
    const strBody = JSON.stringify(objPayload);

    const objRequestOptions = {
      hostname: objUrl.hostname,
      port: objUrl.port || (objUrl.protocol === 'https:' ? 443 : 80),
      path: objUrl.pathname + objUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${objConfig.strIngestToken}`,
        'Content-Length': Buffer.byteLength(strBody, 'utf8'),
      },
      timeout: objConfig.nTimeoutMs,
      agent: objUrl.protocol === 'https:' ? objHttpsAgent : objHttpAgent,
    };

    const fnRequest = objUrl.protocol === 'https:' ? request : requestHttp;

    const objReq = fnRequest(objRequestOptions, (objRes) => {
      const nStatus = objRes.statusCode || 0;
      const bSuccess = nStatus >= 200 && nStatus < 300;

      // Drain response without accumulating body in memory
      objRes.resume();
      objRes.on('end', () => {
        resolveOnce({ bSuccess, nStatusCode: nStatus });
      });
      objRes.on('error', (objErr) => {
        resolveOnce({ bSuccess: false, nStatusCode: nStatus, strError: objErr.message });
      });
    });

    objReq.on('error', (objErr) => {
      resolveOnce({ bSuccess: false, nStatusCode: 0, strError: objErr.message });
    });

    objReq.on('timeout', () => {
      resolveOnce({ bSuccess: false, nStatusCode: 0, strError: 'Request timeout' });
      objReq.destroy();
    });

    // Fallback: if connection closes without firing any of the above handlers
    objReq.on('close', () => {
      if (!bResolved) {
        resolveOnce({ bSuccess: false, nStatusCode: 0, strError: 'Connection closed unexpectedly' });
      }
    });

    objReq.write(strBody);
    objReq.end();
  });
}

function logRetry(nAttempt: number, nWaitMs: number, strError?: string): void {
  const strNow = new Date().toISOString();
  const strReason = strError || 'unknown error';
  process.stdout.write(`[${strNow}] retry: attempt ${nAttempt}, waiting ${Math.round(nWaitMs)}ms (${strReason})\n`);
}

function sleep(nMs: number): Promise<void> {
  return new Promise((fnResolve) => setTimeout(fnResolve, nMs));
}
