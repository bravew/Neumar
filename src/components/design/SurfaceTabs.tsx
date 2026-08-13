import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSurface } from '@/shared/types/design-mode';

import { localizedSurfaceLabel, SURFACE_OPTIONS } from './constants';

interface SurfaceTabsProps {
  value: DesignSurface | 'other' | 'media';
  onChange: (surface: DesignSurface | 'other' | 'media') => void;
}

export function SurfaceTabsShell({ value, onChange }: SurfaceTabsProps) {
  const { t } = useLanguage();
  const selected =
    SURFACE_OPTIONS.find((item) => item.id === value) ?? SURFACE_OPTIONS[0];
  const SelectedIcon = selected.icon;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="design-surface-picker"
          aria-label={t.design.surfaceLabel}
          className="border-border bg-background hover:bg-accent flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <SelectedIcon className="text-foreground size-4 shrink-0" />
            <span className="text-sm font-medium">
              {localizedSurfaceLabel(selected.id, t.design.surfaces)}
            </span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        sideOffset={6}
        className="bg-popover text-popover-foreground z-50 w-[var(--radix-popover-trigger-width)] min-w-60 rounded-md border p-1 shadow-md"
      >
        <ul role="menu" className="flex flex-col">
          {SURFACE_OPTIONS.map((item) => {
            const Icon = item.icon;
            const active = value === item.id;
            const label = localizedSurfaceLabel(item.id, t.design.surfaces);
            return (
              <li key={item.id} role="none">
                <Popover.Close asChild>
                  <button
                    type="button"
                    role="menuitemradio"
                    data-testid={`design-surface-${item.id}`}
                    aria-checked={active}
                    onClick={() => onChange(item.id)}
                    className={cn(
                      'hover:bg-accent flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors',
                      active && 'bg-accent/60',
                    )}
                  >
                    <Icon className="text-foreground size-4 shrink-0" />
                    <span className="flex-1 truncate">{label}</span>
                    {active && (
                      <Check className="text-primary size-4 shrink-0" />
                    )}
                  </button>
                </Popover.Close>
              </li>
            );
          })}
        </ul>
      </Popover.Content>
    </Popover.Root>
  );
}
