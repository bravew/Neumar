import type { ReactNode } from 'react';

import { Search, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface AssetSearchBarProps {
  value: string;
  semantic: boolean;
  onChange: (value: string) => void;
  onSemanticChange: (value: boolean) => void;
  /**
   * Compact summary line (e.g. "381 assets · 2 selected") rendered between
   * the input and the Semantic toggle to reclaim the vertical space the
   * standalone heading row used to occupy.
   */
  summary?: ReactNode;
}

export function AssetSearchBar({
  value,
  semantic,
  onChange,
  onSemanticChange,
  summary,
}: AssetSearchBarProps) {
  const { t } = useLanguage();
  const s = t.assets;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="border-input bg-background flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-sm">
        <Search className="text-muted-foreground size-4" aria-hidden />
        <input
          data-testid="asset-search-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={s.searchPlaceholder}
          placeholder={s.searchPlaceholder}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
        />
        {value ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded p-1"
            onClick={() => onChange('')}
            aria-label={s.clearSearch}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </label>
      <Button
        type="button"
        variant="outline"
        onClick={() => onSemanticChange(!semantic)}
        aria-pressed={semantic}
        className={cn(
          'h-10 shrink-0 gap-2',
          semantic && 'border-primary bg-primary/10 text-primary',
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        {s.semantic}
      </Button>
      {summary ? (
        <p
          className="text-muted-foreground shrink-0 truncate text-xs tabular-nums sm:max-w-[18rem]"
          aria-live="polite"
        >
          {summary}
        </p>
      ) : null}
    </div>
  );
}
