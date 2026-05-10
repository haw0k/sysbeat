export interface IMetricPayload {
  deviceId: string;
  timestamp: number;
  cpu: {
    usage: number;
    user: number;
    system: number;
    idle: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  load: [number, number, number];
}

export interface IAggregationBucket {
  bucket: string;
  avgCpu: number;
  maxCpu: number;
  avgMem: number;
  maxMem: number;
  samples: number;
}

export interface IDeviceInfo {
  deviceId: string;
  lastSeen: number;
  isOnline: boolean;
}

export type IWebSocketMessage =
  | { type: 'init'; deviceId: string; metrics: IMetricPayload[] }
  | { type: 'update'; deviceId: string; metric: IMetricPayload }
  | { type: 'device-online'; deviceId: string }
  | { type: 'device-offline'; deviceId: string }
  | { type: 'aggregation'; deviceId: string; data: IAggregationBucket[] };

export interface IHealthResponse {
  status: string;
  uptime: number;
  dbSizeBytes: number;
  deviceCount: number;
  lastIngestTimestamp: number | null;
}

export interface IRateLimitEntry {
  nCount: number;
  nResetTime: number;
}
