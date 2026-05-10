import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { useDashboardStore } from '@/stores/dashboard';
import { BASE_CHART_OPTIONS, COLORS } from '@/lib/chart-config';
import { format } from 'date-fns';

export function CpuChart() {
  const history = useDashboardStore((s) => s.history);

  const data = useMemo(() => {
    const labels = history.map((m) => format(m.timestamp, 'HH:mm:ss'));
    return {
      labels,
      datasets: [
        {
          label: 'User',
          data: history.map((m) => m.cpu.user),
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
            const chart = ctx.chart;
            const { ctx: canvasCtx, chartArea } = chart;
            if (!chartArea) return COLORS.user;
            const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, COLORS.user + '60');
            gradient.addColorStop(1, COLORS.user + '05');
            return gradient;
          },
          borderColor: COLORS.user,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: 'System',
          data: history.map((m) => m.cpu.system),
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
            const chart = ctx.chart;
            const { ctx: canvasCtx, chartArea } = chart;
            if (!chartArea) return COLORS.system;
            const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, COLORS.system + '60');
            gradient.addColorStop(1, COLORS.system + '05');
            return gradient;
          },
          borderColor: COLORS.system,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: 'Idle',
          data: history.map((m) => m.cpu.idle),
          borderColor: COLORS.idle,
          borderDash: [6, 4],
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1,
          fill: false,
        },
      ],
    };
  }, [history]);

  const options = useMemo(() => {
    const base = BASE_CHART_OPTIONS;
    return {
      ...base,
      scales: {
        ...base.scales,
        y: {
          ...base.scales.y,
          stacked: true,
          min: 0,
          max: 100,
        },
      },
    };
  }, []);

  return (
    <div className="h-[260px] w-full">
      <Line data={data} options={options} />
    </div>
  );
}
