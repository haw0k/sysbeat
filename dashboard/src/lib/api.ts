import { config } from '@/config';
import type { IDeviceInfo, IMetricPayload, IAggregationBucket, TResolution } from '@/types';

interface IMetricsResponse {
  deviceId: string;
  resolution: string;
  data: IMetricPayload[] | IAggregationBucket[];
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.ingestToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new ApiError(text || `HTTP ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}

export function buildApiUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(path, config.apiUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

export async function fetchDevices(): Promise<IDeviceInfo[]> {
  return request<IDeviceInfo[]>(buildApiUrl('/devices'));
}

export async function fetchMetrics(
  deviceId: string,
  resolution: TResolution,
  limit?: number
): Promise<IMetricsResponse> {
  const query: Record<string, string> = { resolution };
  if (limit !== undefined) {
    query.limit = String(limit);
  }
  const url = buildApiUrl(`/api/metrics/${encodeURIComponent(deviceId)}`, query);
  return request<IMetricsResponse>(url);
}

export async function fetchHealth(): Promise<{ status: string }> {
  return request<{ status: string }>(buildApiUrl('/health'));
}
