import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend
);

ChartJS.defaults.color = '#6b7a94';
ChartJS.defaults.borderColor = 'rgba(107, 122, 148, 0.12)';
ChartJS.defaults.backgroundColor = 'transparent';

export const COLORS = {
  user: '#00d4ff',
  system: '#ff3366',
  idle: 'rgba(0, 255, 136, 0.4)',
  used: '#ffaa00',
  total: 'rgba(107, 122, 148, 0.5)',
  load1m: '#00d4ff',
  load5m: '#ffaa00',
  load15m: '#ff3366',
} as const;

export const BASE_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 0 },
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      position: 'top' as const,
      align: 'end' as const,
      labels: {
        color: '#6b7a94',
        boxWidth: 10,
        boxHeight: 10,
        usePointStyle: true,
        pointStyle: 'circle',
        padding: 16,
        font: {
          family: "'JetBrains Mono', monospace",
          size: 11,
        },
      },
    },
    tooltip: {
      backgroundColor: 'rgba(6, 11, 20, 0.95)',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(0, 212, 255, 0.2)',
      borderWidth: 1,
      cornerRadius: 8,
      padding: 12,
      titleFont: {
        family: "'DM Sans', sans-serif",
        size: 12,
        weight: 'bold',
      },
      bodyFont: {
        family: "'JetBrains Mono', monospace",
        size: 11,
      },
      displayColors: true,
      boxPadding: 4,
    },
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(107, 122, 148, 0.08)',
        drawBorder: false,
      },
      ticks: {
        color: '#4a5568',
        maxTicksLimit: 8,
        font: {
          family: "'JetBrains Mono', monospace",
          size: 10,
        },
      },
      border: { display: false },
    },
    y: {
      grid: {
        color: 'rgba(107, 122, 148, 0.08)',
        drawBorder: false,
      },
      ticks: {
        color: '#4a5568',
        font: {
          family: "'JetBrains Mono', monospace",
          size: 10,
        },
      },
      border: { display: false },
    },
  },
} as const;
