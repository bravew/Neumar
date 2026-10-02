import type { ReactNode } from 'react';

import { ChevronRight } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

interface RowFrame {
  label: string;
  caption?: string;
}

type SettingsRowProps = RowFrame &
  (
    | {
        variant: 'toggle';
        checked: boolean;
        onCheckedChange: (checked: boolean) => void;
      }
    | {
        variant: 'segmented';
        value: string;
        options: { value: string; label: string }[];
        onValueChange: (value: string) => void;
      }
    | {
        variant: 'select';
        value: string;
        options: { value: string; label: string }[];
        onValueChange: (value: string) => void;
      }
    | { variant: 'chevron'; onSelect: () => void }
    | { variant: 'button'; actionLabel: string; onAction: () => void }
    | { variant: 'status'; status: string }
  );

export function SettingsRow(props: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-foreground text-sm">{props.label}</p>
        {props.caption ? (
          <p className="text-muted-foreground text-xs">{props.caption}</p>
        ) : null}
      </div>
      <RowControl {...props} />
    </div>
  );
}

function RowControl(props: SettingsRowProps): ReactNode {
  switch (props.variant) {
    case 'toggle':
      return (
        <button
          type="button"
          role="switch"
          aria-checked={props.checked}
          aria-label={props.label}
          onClick={() => props.onCheckedChange(!props.checked)}
          className={cn(
            'relative h-6 w-10 shrink-0 rounded-full transition-colors',
            props.checked ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'bg-background absolute top-0.5 size-5 rounded-full transition-transform',
              props.checked ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      );
    case 'segmented':
      return (
        <div className="bg-muted flex shrink-0 rounded-lg p-0.5">
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === props.value}
              onClick={() => props.onValueChange(option.value)}
              className={cn(
                'rounded-md px-2 py-1 text-xs',
                option.value === props.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      );
    case 'select':
      return (
        <select
          aria-label={props.label}
          value={props.value}
          onChange={(event) => props.onValueChange(event.target.value)}
          className="border-border bg-background rounded-md border px-2 py-1 text-sm"
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'chevron':
      return (
        <button
          type="button"
          aria-label={props.label}
          onClick={props.onSelect}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      );
    case 'button':
      return (
        <button
          type="button"
          onClick={props.onAction}
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
        >
          {props.actionLabel}
        </button>
      );
    case 'status':
      return (
        <span className="text-muted-foreground text-sm">{props.status}</span>
      );
    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}
