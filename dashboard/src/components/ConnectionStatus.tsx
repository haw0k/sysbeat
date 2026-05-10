import { Badge } from '@/components/ui/badge';
import type { TConnectionStatus } from '@/types';

interface IConnectionStatusProps {
  status: TConnectionStatus;
}

const STATUS_CONFIG: Record<TConnectionStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; dotClass: string; glowClass: string }> = {
  online: {
    label: 'Online',
    variant: 'default',
    dotClass: 'bg-accent',
    glowClass: 'shadow-[0_0_8px_rgba(0,255,136,0.5)]',
  },
  reconnecting: {
    label: 'Reconnecting',
    variant: 'secondary',
    dotClass: 'bg-[#ffaa00] animate-pulse',
    glowClass: 'shadow-[0_0_8px_rgba(255,170,0,0.4)]',
  },
  offline: {
    label: 'Offline',
    variant: 'destructive',
    dotClass: 'bg-destructive',
    glowClass: 'shadow-[0_0_8px_rgba(255,51,102,0.4)]',
  },
};

export function ConnectionStatus({ status }: IConnectionStatusProps) {
  const entry = STATUS_CONFIG[status];
  if (!entry) {
    return null;
  }
  const { label, variant, dotClass, glowClass } = entry;

  return (
    <Badge variant={variant} className={`gap-1.5 font-mono text-xs tracking-wide ${glowClass}`}>
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      {label}
    </Badge>
  );
}
