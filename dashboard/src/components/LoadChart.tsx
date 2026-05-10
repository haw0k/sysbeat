import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { useDashboardStore } from '@/stores/dashboard';
import { BASE_CHART_OPTIONS, COLORS } from '@/lib/chart-config';
import { format } from 'date-fns';

export function LoadChart() {
  const history = useDashboardStore((s) => s.history);

  const data = useMemo(() => {
    const labels = history.map((m) => format(m.timestamp, 'HH:mm:ss'));
    return {
      labels,
      datasets: [
        {
          label: '1m',
          data: history.map((m) => m.load[0]),
          borderColor: COLORS.load1m,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: '5m',
          data: history.map((m) => m.load[1]),
          borderColor: COLORS.load5m,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: '15m',
          data: history.map((m) => m.load[2]),
          borderColor: COLORS.load15m,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
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
          min: 0,
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
