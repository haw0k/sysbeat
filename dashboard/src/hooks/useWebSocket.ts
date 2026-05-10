import { useEffect, useRef, useCallback } from 'react';
import { config } from '@/config';
import { useDashboardStore } from '@/stores/dashboard';
import type { TWebSocketMessage } from '@/types';

const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;

export function useWebSocket(): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const attemptRef = useRef(0);
  const isCleanupRef = useRef(false);

  const selectedDevice = useDashboardStore((s) => s.selectedDevice);
  const setConnected = useDashboardStore((s) => s.setConnected);
  const setConnectionStatus = useDashboardStore((s) => s.setConnectionStatus);
  const pushMetric = useDashboardStore((s) => s.pushMetric);
  const setInitMetrics = useDashboardStore((s) => s.setInitMetrics);
  const setHourly = useDashboardStore((s) => s.setHourly);
  const markDeviceOnline = useDashboardStore((s) => s.markDeviceOnline);
  const markDeviceOffline = useDashboardStore((s) => s.markDeviceOffline);

  const cleanup = useCallback(() => {
    isCleanupRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    backoffRef.current = INITIAL_BACKOFF_MS;
    attemptRef.current = 0;
  }, [setConnected]);

  const connect = useCallback(() => {
    if (!selectedDevice || isCleanupRef.current) return;

    isCleanupRef.current = false;
    setConnectionStatus('reconnecting');

    const wsUrl = `${config.wsUrl}/stream?deviceId=${encodeURIComponent(selectedDevice)}&token=${encodeURIComponent(config.ingestToken)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      if (isCleanupRef.current) return;
      backoffRef.current = INITIAL_BACKOFF_MS;
      attemptRef.current = 0;
      setConnected(true);
    });

    ws.addEventListener('message', (event) => {
      if (isCleanupRef.current) return;
      try {
        const message = JSON.parse(event.data) as TWebSocketMessage;

        // device-online/offline events are global — process regardless of selectedDevice
        if (message.type === 'device-online') {
          markDeviceOnline(message.deviceId);
          return;
        }
        if (message.type === 'device-offline') {
          markDeviceOffline(message.deviceId);
          return;
        }

        if (message.deviceId !== selectedDevice) return;
        handleMessage(message);
      } catch {
        console.error('[WS] Failed to parse message:', event.data);
      }
    });

    ws.addEventListener('close', () => {
      if (isCleanupRef.current || wsRef.current !== ws) return;
      setConnected(false);
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      if (isCleanupRef.current) return;
      setConnected(false);
    });

    function handleMessage(message: TWebSocketMessage) {
      switch (message.type) {
        case 'init':
          setInitMetrics(message.metrics);
          break;
        case 'update':
          pushMetric(message.metric);
          break;
        case 'device-online':
          markDeviceOnline(message.deviceId);
          break;
        case 'device-offline':
          markDeviceOffline(message.deviceId);
          break;
        case 'aggregation':
          setHourly(message.data);
          break;
      }
    }

    function scheduleReconnect() {
      if (isCleanupRef.current) return;
      attemptRef.current += 1;

      const jitter = Math.random() * 200;
      const wait = Math.min(backoffRef.current + jitter, MAX_BACKOFF_MS);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        connect();
      }, wait);
    }
  }, [
    selectedDevice,
    setConnected,
    setConnectionStatus,
    pushMetric,
    setInitMetrics,
    setHourly,
    markDeviceOnline,
    markDeviceOffline,
  ]);

  useEffect(() => {
    isCleanupRef.current = false;
    if (selectedDevice) {
      connect();
    }
    return () => {
      cleanup();
    };
  }, [selectedDevice, connect, cleanup]);
}
