interface IConfig {
  apiUrl: string;
  wsUrl: string;
  ingestToken: string;
}

function requireEnv(key: string): string {
  const value = import.meta.env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function optionalUrl(key: string): string {
  const value = (import.meta.env[key] as string | undefined) ?? '';
  if (value === '') return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error(`Unsupported protocol in ${key}: ${parsed.protocol}`);
    }
    return value;
  } catch {
    throw new Error(`${key}=${value} is not a valid URL`);
  }
}

export const config: IConfig = {
  apiUrl: optionalUrl('VITE_API_URL'),
  wsUrl: optionalUrl('VITE_WS_URL'),
  ingestToken: requireEnv('VITE_INGEST_TOKEN'),
};
