import { Select } from '@/components/ui/select';
import { useDashboardStore } from '@/stores/dashboard';
import type { ISelectOption } from '@/components/ui/select';

export function DeviceSelector() {
  const devices = useDashboardStore((s) => s.devices);
  const selectedDevice = useDashboardStore((s) => s.selectedDevice);
  const setDevice = useDashboardStore((s) => s.setDevice);

  const options: ISelectOption[] = devices.map((device) => ({
    value: device.deviceId,
    label: device.deviceId,
  }));

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/50 px-3 py-2">
        <div className="flex gap-1" aria-hidden="true">
          {devices.map((device) => (
            <div
              key={device.deviceId}
              className={`h-2 w-2 rounded-full transition-colors ${
                device.isOnline
                  ? 'bg-accent shadow-[0_0_6px_rgba(0,255,136,0.6)]'
                  : 'bg-muted-foreground/30'
              }`}
              title={`${device.deviceId} ${device.isOnline ? 'online' : 'offline'}`}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {devices.filter((d) => d.isOnline).length}/{devices.length} online
        </span>
      </div>
      <Select
        value={selectedDevice ?? ''}
        onValueChange={(value) => setDevice(value || null)}
        placeholder="Select device..."
        options={options}
        disabled={devices.length === 0}
        ariaLabel="Select monitored device"
      />
    </div>
  );
}
