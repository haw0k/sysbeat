import { createHash, timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { objConfig } from '../config.js';

function bTimingSafeCompare(strA: string, strB: string): boolean {
  try {
    const bufA = createHash('sha256').update(strA).digest();
    const bufB = createHash('sha256').update(strB).digest();
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function bTokenValid(strToken: string): boolean {
  return bTimingSafeCompare(strToken, objConfig.strIngestToken)
      || bTimingSafeCompare(strToken, objConfig.strDashboardToken);
}

function extractBearer(strAuth: string): string {
  if (strAuth.length <= 7) return strAuth;
  const strPrefix = strAuth.slice(0, 7).toLowerCase();
  return strPrefix === 'bearer ' ? strAuth.slice(7).trimStart() : strAuth;
}

export async function authenticate(
  objRequest: FastifyRequest,
  objReply: FastifyReply
): Promise<void> {
  const strAuth = objRequest.headers.authorization ?? '';
  const strHeaderToken = extractBearer(strAuth);
  const strQueryToken = (objRequest.query as Record<string, string>).token ?? '';
  const strToken = strHeaderToken || strQueryToken;

  if (!bTokenValid(strToken)) {
    await objReply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function authenticateIngest(
  objRequest: FastifyRequest,
  objReply: FastifyReply
): Promise<void> {
  const strAuth = objRequest.headers.authorization ?? '';
  const strToken = extractBearer(strAuth);

  if (!bTimingSafeCompare(strToken, objConfig.strIngestToken)) {
    await objReply.status(401).send({ error: 'Unauthorized' });
  }
}
