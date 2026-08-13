import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';
import type { VideoTimelineClip } from '@/shared/types/video';

export function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-1 border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground border-transparent',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function ClipNameField({
  clip,
  displayName,
  label,
  onChange,
}: {
  clip: VideoTimelineClip;
  displayName?: string;
  label: string;
  onChange: (name: string) => void;
}) {
  const value = clip.name ?? displayName ?? '';
  return (
    <label className="text-muted-foreground grid gap-0.5 text-[10px]">
      <span>{label}</span>
      <input
        key={`${clip.id}:${value}`}
        defaultValue={value}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (next !== (clip.name ?? '')) onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-sm font-semibold"
      />
    </label>
  );
}
