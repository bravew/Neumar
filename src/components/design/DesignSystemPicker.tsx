import { useMemo, useState } from 'react';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

interface DesignSystemPickerProps {
  systems: DesignSystemRecord[];
  value: string | null;
  inspirations: string[];
  onChange: (value: string | null, inspirations: string[]) => void;
}

export function DesignSystemPicker({
  systems,
  value,
  inspirations,
  onChange,
}: DesignSystemPickerProps) {
  const { t, tt } = useLanguage();
  const [query, setQuery] = useState('');
  const [multi, setMulti] = useState(false);
  const selected = value
    ? systems.find((system) => system.id === value)
    : undefined;
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return systems.filter(
      (system) =>
        system.title.toLowerCase().includes(q) ||
        system.category.toLowerCase().includes(q),
    );
  }, [query, systems]);
  const showNoSystemOption = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return [t.design.noDesignSystem, t.design.noDesignSystemSummary]
      .join(' ')
      .toLowerCase()
      .includes(q);
  }, [query, t.design.noDesignSystem, t.design.noDesignSystemSummary]);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="design-system-picker"
          className="border-border bg-background hover:bg-accent flex w-full items-center justify-between rounded-md border p-3 text-left"
        >
          <span className="flex min-w-0 items-center gap-3">
            <Swatches colors={selected?.swatches ?? []} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {selected?.title ?? t.design.noDesignSystem}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {inspirations.length > 0
                  ? tt('design.inspirationsCount', {
                      count: inspirations.length,
                    })
                  : selected?.category || t.design.noDesignSystemSummary}
              </span>
            </span>
          </span>
          <ChevronDown className="text-muted-foreground size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        sideOffset={8}
        className="bg-popover text-popover-foreground z-50 w-[360px] rounded-md border p-3 shadow-md"
      >
        <div className="border-input flex h-9 items-center gap-2 rounded-md border px-2">
          <Search className="text-muted-foreground size-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.design.searchSystems}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            {multi ? t.design.inspirationMode : t.design.primarySystem}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMulti((prev) => !prev)}
          >
            {multi ? t.design.single : t.design.multi}
          </Button>
        </div>
        <div role="listbox" className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {showNoSystemOption && (
            <button
              type="button"
              role="option"
              aria-selected={!value && inspirations.length === 0}
              className={cn(
                'hover:bg-accent flex w-full items-center gap-3 rounded-md p-2 text-left',
                !value && inspirations.length === 0 && 'bg-accent',
              )}
              onClick={() => onChange(null, [])}
            >
              <span className="border-muted-foreground/30 bg-muted flex size-8 shrink-0 items-center justify-center rounded-md border">
                <X className="text-muted-foreground size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {t.design.noDesignSystem}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {t.design.noDesignSystemSummary}
                </span>
              </span>
              {!value && inspirations.length === 0 && (
                <Check className="size-4" />
              )}
            </button>
          )}
          {filtered.map((system) => {
            const active = value === system.id;
            const inspired = inspirations.includes(system.id);
            return (
              <button
                key={system.id}
                type="button"
                role="option"
                aria-selected={active || inspired}
                className={cn(
                  'hover:bg-accent flex w-full items-center gap-3 rounded-md p-2 text-left',
                  (active || inspired) && 'bg-accent',
                )}
                onClick={() => {
                  if (multi) {
                    const next = inspired
                      ? inspirations.filter((id) => id !== system.id)
                      : [...inspirations, system.id];
                    onChange(value, next);
                  } else {
                    onChange(
                      system.id,
                      inspirations.filter((id) => id !== system.id),
                    );
                  }
                }}
              >
                <Swatches colors={system.swatches} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{system.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {system.summary}
                  </span>
                </span>
                {(active || inspired) && <Check className="size-4" />}
              </button>
            );
          })}
        </div>
        {(value || inspirations.length > 0) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => onChange(null, [])}
          >
            <X className="size-4" />
            {t.design.clearSelection}
          </Button>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

export function Swatches({ colors }: { colors: string[] }) {
  const safe =
    colors.length > 0
      ? colors.slice(0, 4)
      : ['#111827', '#f9fafb', '#d1d5db', '#6b7280'];
  return (
    <span className="grid size-8 shrink-0 grid-cols-2 overflow-hidden rounded-md border">
      {safe.map((color, index) => (
        <span key={`${color}-${index}`} style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}
