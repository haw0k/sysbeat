import { create } from 'zustand';
import type { IMetricPayload, IAggregationBucket, IDeviceInfo, TConnectionStatus } from '@/types';

interface IDashboardState {
  isConnected: boolean;
  connectionStatus: TConnectionStatus;
  selectedDevice: string | null;
  devices: IDeviceInfo[];
  currentMetric: IMetricPayload | null;
  history: IMetricPayload[];
  hourly: IAggregationBucket[];
  lastUpdateTimestamp: number | null;
  setConnected: (isConnected: boolean) => void;
  setDevice: (deviceId: string | null) => void;
  pushMetric: (metric: IMetricPayload) => void;
  setInitMetrics: (metrics: IMetricPayload[]) => void;
  setDevices: (devices: IDeviceInfo[]) => void;
  setHourly: (data: IAggregationBucket[]) => void;
  markDeviceOnline: (deviceId: string) => void;
  markDeviceOffline: (deviceId: string) => void;
  clearHistory: () => void;
  setConnectionStatus: (status: TConnectionStatus) => void;
}

const MAX_HISTORY = 300;

export const useDashboardStore = create<IDashboardState>((set) => ({
  isConnected: false,
  connectionStatus: 'offline',
  selectedDevice: null,
  devices: [],
  currentMetric: null,
  history: [],
  hourly: [],
  lastUpdateTimestamp: null,

  setConnected: (isConnected) =>
    set((state) => ({
      isConnected,
      connectionStatus: isConnected ? 'online' : state.connectionStatus,
    })),

  setConnectionStatus: (status) =>
    set({ connectionStatus: status }),

  setDevice: (selectedDevice) =>
    set({
      selectedDevice,
      history: [],
      currentMetric: null,
      hourly: [],
    }),

  pushMetric: (metric) =>
    set((state) => {
      const nextHistory = [...state.history, metric];
      const trimmed =
        nextHistory.length > MAX_HISTORY
          ? nextHistory.slice(nextHistory.length - MAX_HISTORY)
          : nextHistory;
      return {
        history: trimmed,
        currentMetric: metric,
        lastUpdateTimestamp: Date.now(),
      };
    }),

  setInitMetrics: (metrics) =>
    set({
      history: metrics.slice(-MAX_HISTORY),
      currentMetric: metrics[metrics.length - 1] ?? null,
      lastUpdateTimestamp: Date.now(),
    }),

  setDevices: (devices) => set({ devices }),

  setHourly: (hourly) => set({ hourly }),

  markDeviceOnline: (deviceId) =>
    set((state) => {
      const exists = state.devices.some((d) => d.deviceId === deviceId);
      if (!exists) {
        return {
          devices: [
            ...state.devices,
            { deviceId, lastSeen: Date.now(), isOnline: true },
          ],
        };
      }
      return {
        devices: state.devices.map((d) =>
          d.deviceId === deviceId ? { ...d, isOnline: true } : d
        ),
      };
    }),

  markDeviceOffline: (deviceId) =>
    set((state) => ({
      devices: state.devices.map((d) =>
        d.deviceId === deviceId ? { ...d, isOnline: false } : d
      ),
    })),

  clearHistory: () =>
    set({ history: [], currentMetric: null, hourly: [] }),
}));
