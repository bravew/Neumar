import { useLanguage } from '@/shared/providers/language-provider';

export type DeviceViewportId = 'auto' | 'mobile' | 'tablet' | 'desktop';

export const DEVICE_VIEWPORTS: Record<
  Exclude<DeviceViewportId, 'auto'>,
  { width: number; height: number }
> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
};

export function DevicePicker({
  value,
  onChange,
}: {
  value: DeviceViewportId;
  onChange: (value: DeviceViewportId) => void;
}) {
  const { t } = useLanguage();
  const options: Array<{ id: DeviceViewportId; label: string }> = [
    { id: 'auto', label: t.design.deviceAuto },
    { id: 'mobile', label: t.design.devicePhone },
    { id: 'tablet', label: t.design.deviceTablet },
    { id: 'desktop', label: t.design.deviceDesktop },
  ];
  return (
    <div
      className="bg-muted inline-flex rounded-md p-0.5"
      role="group"
      aria-label={t.design.deviceViewport}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="data-[active=true]:bg-background data-[active=true]:text-foreground text-muted-foreground rounded px-2 py-1 text-xs"
          data-active={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
