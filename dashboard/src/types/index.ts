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

export interface IHealthResponse {
  status: string;
  uptime: number;
  dbSizeBytes: number;
  deviceCount: number;
  lastIngestTimestamp: number | null;
}

export type TConnectionStatus = 'online' | 'offline' | 'reconnecting';

export type TResolution = 'raw' | 'hourly';

export interface IWebSocketInitMessage {
  type: 'init';
  deviceId: string;
  metrics: IMetricPayload[];
}

export interface IWebSocketUpdateMessage {
  type: 'update';
  deviceId: string;
  metric: IMetricPayload;
}

export interface IWebSocketDeviceOnlineMessage {
  type: 'device-online';
  deviceId: string;
}

export interface IWebSocketDeviceOfflineMessage {
  type: 'device-offline';
  deviceId: string;
}

export interface IWebSocketAggregationMessage {
  type: 'aggregation';
  deviceId: string;
  data: IAggregationBucket[];
}

export type TWebSocketMessage =
  | IWebSocketInitMessage
  | IWebSocketUpdateMessage
  | IWebSocketDeviceOnlineMessage
  | IWebSocketDeviceOfflineMessage
  | IWebSocketAggregationMessage;
