import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { useDashboardStore } from '@/stores/dashboard';
import { BASE_CHART_OPTIONS, COLORS } from '@/lib/chart-config';
import { format } from 'date-fns';

export function MemoryChart() {
  const history = useDashboardStore((s) => s.history);

  const data = useMemo(() => {
    const labels = history.map((m) => format(m.timestamp, 'HH:mm:ss'));
    return {
      labels,
      datasets: [
        {
          label: 'Used',
          data: history.map((m) => m.memory.used),
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
            const chart = ctx.chart;
            const { ctx: canvasCtx, chartArea } = chart;
            if (!chartArea) return COLORS.used;
            const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, COLORS.used + '50');
            gradient.addColorStop(1, COLORS.used + '05');
            return gradient;
          },
          borderColor: COLORS.used,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: 'Free',
          data: history.map((m) => m.memory.free),
          borderColor: 'rgba(0, 255, 136, 0.5)',
          borderDash: [6, 4],
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1,
        },
      ],
    };
  }, [history]);

  const options = useMemo(() => {
    const base = BASE_CHART_OPTIONS;
    return {
      ...base,
    };
  }, []);

  return (
    <div className="h-[260px] w-full">
      <Line data={data} options={options} />
    </div>
  );
}
