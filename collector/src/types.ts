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
