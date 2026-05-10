import dotenv from 'dotenv';

dotenv.config();

function getEnv(strKey: string, strDefault?: string): string {
  const strValue = process.env[strKey];
  if (strValue === undefined || strValue.trim() === '') {
    if (strDefault !== undefined) return strDefault;
    throw new Error(`Environment variable ${strKey} is required`);
  }
  return strValue;
}

function getEnvInt(strKey: string, nDefault: number): number {
  const strValue = process.env[strKey];
  if (strValue === undefined || strValue.trim() === '') {
    return nDefault;
  }
  const nParsed = Number(strValue);
  if (!Number.isFinite(nParsed) || nParsed <= 0) {
    throw new Error(`Environment variable ${strKey} must be a positive number, got: ${strValue}`);
  }
  return nParsed;
}

function validateUrl(strUrl: string): string {
  try {
    const objUrl = new URL(strUrl);
    if (objUrl.protocol !== 'http:' && objUrl.protocol !== 'https:') {
      throw new Error(`URL protocol must be http: or https:, got: ${objUrl.protocol}`);
    }
    if (!objUrl.hostname) {
      throw new Error(`URL must have a hostname, got: ${strUrl}`);
    }
    return strUrl;
  } catch {
    throw new Error(`SERVER_URL must be a valid URL starting with http:// or https://, got: ${strUrl}`);
  }
}

export const objConfig = {
  strServerUrl: validateUrl(getEnv('SERVER_URL')),
  strIngestToken: getEnv('INGEST_TOKEN'),
  strDeviceId: getEnv('DEVICE_ID'),
  nIntervalMs: getEnvInt('INTERVAL_MS', 1000),
  nTimeoutMs: 5000,
} as const;
