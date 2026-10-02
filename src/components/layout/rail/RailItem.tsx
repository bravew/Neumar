import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

export function RailItem({
  label,
  shortcut,
  active,
  badge,
  onSelect,
  children,
  className,
  onClick,
  ...buttonProps
}: Omit<ComponentPropsWithRef<'button'>, 'onSelect' | 'children'> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  badge?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}) {
  // Extra button props (ref, handlers, aria state) let a Radix `asChild`
  // trigger wrap a rail item without losing its label or styling.
  return (
    <button
      type="button"
      {...buttonProps}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        onClick?.(event);
        onSelect?.();
      }}
      className={cn(
        'relative flex size-10 items-center justify-center rounded-xl',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
        className,
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
