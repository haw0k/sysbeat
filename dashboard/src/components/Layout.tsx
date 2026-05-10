import { Activity } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { DeviceSelector } from './DeviceSelector';
import { useDashboardStore } from '@/stores/dashboard';
import { useMetrics } from '@/hooks/useMetrics';
import { format } from 'date-fns';

export function Layout({ children }: { children: React.ReactNode }) {
  const status = useDashboardStore((s) => s.connectionStatus);
  useMetrics();

  const lastUpdateTimestamp = useDashboardStore((s) => s.lastUpdateTimestamp);
  const devices = useDashboardStore((s) => s.devices);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card/50 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">sysbeat</h1>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Real-time System Monitor
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {devices.length > 0 && <DeviceSelector />}
            <ConnectionStatus status={status} />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {lastUpdateTimestamp && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-slow" />
              <span className="font-mono">
                Last update: {format(lastUpdateTimestamp, 'HH:mm:ss.SSS')}
              </span>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
