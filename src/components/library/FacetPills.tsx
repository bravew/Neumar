/**
 * FacetPills — a labeled row of multi-select filter pills with result counts,
 * following faceted-search conventions: counts reflect the other active
 * filters, empty selection means "all", and each pill toggles independently.
 */

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export function FacetPills({
  label,
  values,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  values: FacetValue[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  if (values.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground w-16 shrink-0 text-xs font-medium">
        {label}
      </span>
      <button
        type="button"
        onClick={onClear}
        className={cn(
          'rounded-full border px-2.5 py-1 text-xs transition-colors',
          selected.size === 0
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground hover:text-foreground',
        )}
      >
        {t.plugins.categories.all}
      </button>
      {values.map((facet) => (
        <button
          key={facet.value}
          type="button"
          onClick={() => onToggle(facet.value)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs transition-colors',
            selected.has(facet.value)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {facet.label}
          <span className="ml-1 opacity-70">{facet.count}</span>
        </button>
      ))}
    </div>
  );
}
