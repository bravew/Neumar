import type { DesignSurface } from '@/shared/types/design-mode';

export type MediaSurface = Extract<DesignSurface, 'image' | 'video' | 'audio'>;

export function MediaSurfacePicker({
  value,
  labels,
  onChange,
}: {
  value: MediaSurface;
  labels: Record<string, string>;
  onChange: (value: MediaSurface) => void;
}) {
  return (
    <div className="bg-muted inline-flex w-full rounded-md p-0.5">
      {(['image', 'video', 'audio'] as const).map((surface) => (
        <button
          key={surface}
          type="button"
          aria-pressed={value === surface}
          className="data-[active=true]:bg-background data-[active=true]:text-foreground text-muted-foreground flex-1 rounded px-3 py-1.5 text-sm"
          data-active={value === surface}
          onClick={() => onChange(surface)}
        >
          {labels[surface]}
        </button>
      ))}
    </div>
  );
}
