import { useMemo, useId } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface IMetricCardProps {
  title: string;
  value: string;
  subtext?: string;
  sparklineData?: number[];
  sparklineColor?: string;
  delay?: number;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;

  const id = useId();
  const gradientId = `spark-${id}`;

  const width = 200;
  const height = 40;
  const padding = 2;

  const { points, areaPath } = useMemo(() => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const pts = data.map((value, index) => {
      const x = (index / (data.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    const path = `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')} L${width - padding},${height} L${padding},${height} Z`;
    return { points: pts, areaPath: path };
  }, [data]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-2 h-10 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Sparkline showing ${data.length} recent values`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetricCard({
  title,
  value,
  subtext,
  sparklineData,
  sparklineColor = '#00d4ff',
  delay = 0,
}: IMetricCardProps) {
  return (
    <Card
      className="glass-card overflow-hidden animate-slide-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="metric-value text-3xl font-semibold tracking-tight">
          {value}
        </div>
        {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
        {sparklineData && sparklineData.length > 0 && (
          <Sparkline data={sparklineData} color={sparklineColor} />
        )}
      </CardContent>
    </Card>
  );
}
