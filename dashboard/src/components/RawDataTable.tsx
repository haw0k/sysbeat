import { useMemo, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useDashboardStore } from '@/stores/dashboard';
import type { IMetricPayload } from '@/types';
import { format } from 'date-fns';
import { Download, Database } from 'lucide-react';

function escapeCsv(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCsv(metrics: IMetricPayload[]): void {
  const headers = 'timestamp,deviceId,cpu_usage,cpu_user,cpu_system,cpu_idle,mem_total_mb,mem_used_mb,mem_free_mb,mem_percent,load_1m,load_5m,load_15m';

  const rows = metrics.map((metric) => {
    const { timestamp, deviceId, cpu, memory, load } = metric;
    return [
      new Date(timestamp).toISOString(),
      deviceId,
      cpu.usage,
      cpu.user,
      cpu.system,
      cpu.idle,
      memory.total,
      memory.used,
      memory.free,
      memory.percent,
      load[0],
      load[1],
      load[2],
    ].map(escapeCsv).join(',');
  });

  const csv = [headers, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `sysbeat-metrics-${format(Date.now(), 'yyyy-MM-dd-HHmmss')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function RawDataTable() {
  const history = useDashboardStore((s) => s.history);

  const lastMetrics = useMemo(() => {
    return history.slice(-10).reverse();
  }, [history]);

  const handleExport = useCallback(() => {
    exportCsv(history);
  }, [history]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Last 10 data points
          </h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={history.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Time</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">CPU %</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Mem %</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Load 1m</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Load 5m</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-wider">Load 15m</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lastMetrics.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No data yet
                </TableCell>
              </TableRow>
            ) : (
              lastMetrics.map((metric) => (
                <TableRow key={`${metric.deviceId}-${metric.timestamp}`} className="font-mono text-xs">
                  <TableCell className="text-muted-foreground">
                    {format(metric.timestamp, 'HH:mm:ss.SSS')}
                  </TableCell>
                  <TableCell className="text-primary">{metric.cpu.usage.toFixed(1)}%</TableCell>
                  <TableCell className="text-accent">{metric.memory.percent.toFixed(1)}%</TableCell>
                  <TableCell>{metric.load[0].toFixed(2)}</TableCell>
                  <TableCell>{metric.load[1].toFixed(2)}</TableCell>
                  <TableCell>{metric.load[2].toFixed(2)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
