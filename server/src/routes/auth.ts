import { timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { objConfig } from '../config.js';

export function bTimingSafeCompare(strA: string, strB: string): boolean {
  try {
    const bufA = Buffer.from(strA);
    const bufB = Buffer.from(strB);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export async function authenticate(
  objRequest: FastifyRequest,
  objReply: FastifyReply
): Promise<void> {
  // Support both Authorization header and ?token= query param (for WebSocket)
  const strAuth = objRequest.headers.authorization ?? '';
  const strHeaderToken = strAuth.replace(/^Bearer\s+/i, '');
  const strQueryToken = (objRequest.query as Record<string, string>).token ?? '';
  const strToken = strHeaderToken || strQueryToken;

  if (!bTimingSafeCompare(strToken, objConfig.strIngestToken)) {
    await objReply.status(401).send({ error: 'Unauthorized' });
  }
}
