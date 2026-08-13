import { cn } from '@/shared/lib/utils';

interface TimelineEmptyStateProps {
  title: string;
  empty: string;
  className?: string;
}

export function TimelineEmptyState({
  title,
  empty,
  className,
}: TimelineEmptyStateProps) {
  return (
    <section
      className={cn(
        'border-border bg-background rounded-md border p-4',
        className,
      )}
    >
      <h3 className="text-foreground text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-1 text-xs">{empty}</p>
    </section>
  );
}
