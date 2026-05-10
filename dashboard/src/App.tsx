import { useDashboardStore } from '@/stores/dashboard';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Layout } from '@/components/Layout';
import { MetricCard } from '@/components/MetricCard';
import { DashboardTabs } from '@/components/DashboardTabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Server, Monitor, ArrowRight } from 'lucide-react';

function MetricCards() {
  const currentMetric = useDashboardStore((s) => s.currentMetric);
  const history = useDashboardStore((s) => s.history);
  const connectionStatus = useDashboardStore((s) => s.connectionStatus);

  if (!currentMetric) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const { cpu, memory, load } = currentMetric;

  const memTotalGb = (memory.total / 1024).toFixed(1);
  const memUsedGb = (memory.used / 1024).toFixed(1);

  const cpuSparkline = history.map((m) => m.cpu.usage);
  const memSparkline = history.map((m) => m.memory.percent);
  const loadSparkline = history.map((m) => m.load[0]);

  const statusMap = {
    online: { value: 'Online', subtext: 'Receiving real-time metrics', color: '#00ff88' },
    reconnecting: { value: 'Reconnecting', subtext: 'Attempting to restore connection', color: '#ffaa00' },
    offline: { value: 'Offline', subtext: 'Connection lost — no data incoming', color: '#ff3366' },
  };

  const status = statusMap[connectionStatus];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="CPU Usage"
        value={`${cpu.usage.toFixed(1)}%`}
        subtext={`User ${cpu.user.toFixed(1)}% · System ${cpu.system.toFixed(1)}%`}
        sparklineData={cpuSparkline}
        sparklineColor="#00d4ff"
        delay={0}
      />

      <MetricCard
        title="Memory"
        value={`${memory.percent.toFixed(1)}%`}
        subtext={`${memUsedGb} GB / ${memTotalGb} GB`}
        sparklineData={memSparkline}
        sparklineColor="#ffaa00"
        delay={100}
      />

      <MetricCard
        title="Load Average"
        value={`${load[0].toFixed(2)}`}
        subtext={`5m: ${load[1].toFixed(2)} · 15m: ${load[2].toFixed(2)}`}
        sparklineData={loadSparkline}
        sparklineColor="#ff3366"
        delay={200}
      />

      <MetricCard
        title="Status"
        value={status.value}
        subtext={status.subtext}
        sparklineData={cpuSparkline}
        sparklineColor={status.color}
        delay={300}
      />
    </div>
  );
}

export default function App() {
  const selectedDevice = useDashboardStore((s) => s.selectedDevice);
  const devices = useDashboardStore((s) => s.devices);

  useWebSocket();

  return (
    <Layout>
      <ErrorBoundary>
        {devices.length === 0 ? (
          <div className="flex h-80 flex-col items-center justify-center gap-4 rounded-xl border border-border/50 bg-card/30 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/50">
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold">No devices connected</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Start a sysbeat collector on your Linux device to begin streaming metrics.
            </p>
          </div>
        ) : !selectedDevice ? (
          <div className="flex h-80 flex-col items-center justify-center gap-4 rounded-xl border border-border/50 bg-card/30 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/50">
              <Monitor className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold">Select a device</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Choose a device from the dropdown above to view real-time metrics.
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowRight className="h-4 w-4" />
              <span>Use the device selector in the header</span>
            </div>
          </div>
        ) : (
          <>
            <MetricCards />
            <DashboardTabs />
          </>
        )}
      </ErrorBoundary>
    </Layout>
  );
}
