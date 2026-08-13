import type { PropsWithChildren } from 'react';

import { cn } from '@/shared/lib/utils';

export function ConnectorPanel({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <section className={cn('border-border rounded-lg border p-4', className)}>
      {children}
    </section>
  );
}

export function ConnectorBadge({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'neutral' | 'green' | 'amber' | 'red' }>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'green' && 'bg-emerald-500/10 text-emerald-700',
        tone === 'amber' && 'bg-amber-500/10 text-amber-700',
        tone === 'red' && 'bg-red-500/10 text-red-700',
      )}
    >
      {children}
    </span>
  );
}

export function ConnectorInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      className={cn(
        'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-1 focus:outline-none',
        props.className,
      )}
    />
  );
}
