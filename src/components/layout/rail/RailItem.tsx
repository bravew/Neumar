import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

export function RailItem({
  label,
  shortcut,
  active,
  badge,
  onSelect,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  badge?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
      className={cn(
        'relative flex size-10 items-center justify-center rounded-xl',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {children}
      {badge ? (
        <span
          data-testid="rail-home-badge"
          className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full"
        />
      ) : null}
    </button>
  );
}
