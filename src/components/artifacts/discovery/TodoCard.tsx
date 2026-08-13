import { CheckCircle2, Circle, CircleDot, X } from 'lucide-react';

export interface TodoItem {
  id: string;
  text: string;
  state: 'pending' | 'in-progress' | 'done';
}

export function TodoCardArtifact({
  items,
  dismissLabel,
  onDismiss,
}: {
  items: TodoItem[];
  dismissLabel?: string;
  onDismiss?: () => void;
}) {
  const done = items.filter((item) => item.state === 'done').length;
  return (
    <div className="border-border bg-card rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Plan</h3>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {done}/{items.length}
          </span>
          {onDismiss && dismissLabel && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-muted-foreground hover:text-foreground rounded p-1"
              aria-label={dismissLabel}
              title={dismissLabel}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <ol className="space-y-2">
        {items.map((item) => {
          const Icon =
            item.state === 'done'
              ? CheckCircle2
              : item.state === 'in-progress'
                ? CircleDot
                : Circle;
          return (
            <li key={item.id} className="flex gap-2 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span
                className={
                  item.state === 'done'
                    ? 'text-muted-foreground line-through'
                    : ''
                }
              >
                {item.text}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
