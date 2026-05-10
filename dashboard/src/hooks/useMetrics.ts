import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDashboardStore } from '@/stores/dashboard';
import { fetchDevices, fetchMetrics } from '@/lib/api';
import type { IMetricPayload, IAggregationBucket } from '@/types';

function isMetricPayloadArray(data: unknown[]): data is IMetricPayload[] {
  return data.length > 0 && typeof (data[0] as Record<string, unknown>).timestamp === 'number';
}

function isAggregationBucketArray(data: unknown[]): data is IAggregationBucket[] {
  return data.length > 0 && typeof (data[0] as Record<string, unknown>).bucket === 'string';
}

export function useMetrics() {
  const selectedDevice = useDashboardStore((s) => s.selectedDevice);
  const isConnected = useDashboardStore((s) => s.isConnected);
  const setDevices = useDashboardStore((s) => s.setDevices);
  const setInitMetrics = useDashboardStore((s) => s.setInitMetrics);
  const setHourly = useDashboardStore((s) => s.setHourly);

  const devicesQuery = useQuery({
    queryKey: ['devices'],
    queryFn: fetchDevices,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (devicesQuery.data) {
      setDevices(devicesQuery.data);
    }
  }, [devicesQuery.data, setDevices]);

  const rawMetricsQuery = useQuery({
    queryKey: ['metrics', selectedDevice, 'raw'],
    queryFn: async () => {
      if (!selectedDevice) throw new Error('No device selected');
      const response = await fetchMetrics(selectedDevice, 'raw', 300);
      return response.data;
    },
    enabled: !!selectedDevice && !isConnected,
    staleTime: 5000,
  });

  useEffect(() => {
    if (rawMetricsQuery.data && Array.isArray(rawMetricsQuery.data)) {
      const data = rawMetricsQuery.data;
      if (isMetricPayloadArray(data)) {
        setInitMetrics(data);
      }
    }
  }, [rawMetricsQuery.data, setInitMetrics]);

  const hourlyQuery = useQuery({
    queryKey: ['metrics', selectedDevice, 'hourly'],
    queryFn: async () => {
      if (!selectedDevice) throw new Error('No device selected');
      const response = await fetchMetrics(selectedDevice, 'hourly');
      return response.data;
    },
    enabled: !!selectedDevice,
    staleTime: 60000,
  });

  useEffect(() => {
    if (hourlyQuery.data && Array.isArray(hourlyQuery.data)) {
      const data = hourlyQuery.data;
      if (isAggregationBucketArray(data)) {
        setHourly(data);
      }
    }
  }, [hourlyQuery.data, setHourly]);

  return {
    isLoadingDevices: devicesQuery.isLoading,
    devicesError: devicesQuery.error,
  };
}
