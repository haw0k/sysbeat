interface IConfig {
  apiUrl: string;
  wsUrl: string;
  ingestToken: string;
}

function getEnv(key: string): string {
  const value = import.meta.env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function validateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    return url;
  } catch {
    throw new Error(`${url} is not a valid URL`);
  }
}

export const config: IConfig = {
  apiUrl: validateUrl(getEnv('VITE_API_URL')),
  wsUrl: validateUrl(getEnv('VITE_WS_URL')),
  ingestToken: getEnv('VITE_INGEST_TOKEN'),
};
