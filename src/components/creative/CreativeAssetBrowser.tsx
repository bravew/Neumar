import { useRef, type ReactNode } from 'react';

import { FolderTree, Grid2X2, List, Search, Shapes, Tags } from 'lucide-react';

import { recordCreativeDebugCounter } from '@/shared/creative-workflow/debug-counters';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type CreativeAssetBrowserViewMode =
  | 'grid'
  | 'list'
  | 'grouped'
  | 'folder';

export interface CreativeAssetFilterOption {
  id: string;
  label: string;
  count?: number;
}

interface CreativeAssetBrowserProps {
  children: ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  queryPlaceholder: string;
  empty: boolean;
  emptyMessage: string;
  kindFilters?: readonly CreativeAssetFilterOption[];
  activeKind?: string;
  onKindChange?: (kind: string) => void;
  sourceFilters?: readonly CreativeAssetFilterOption[];
  activeSource?: string;
  onSourceChange?: (source: string) => void;
  tags?: string;
  onTagsChange?: (tags: string) => void;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (date: string) => void;
  onDateToChange?: (date: string) => void;
  semantic?: boolean;
  onSemanticChange?: (semantic: boolean) => void;
  viewMode?: CreativeAssetBrowserViewMode;
  viewModes?: readonly CreativeAssetBrowserViewMode[];
  onViewModeChange?: (mode: CreativeAssetBrowserViewMode) => void;
  totalCount?: number;
  selectedCount?: number;
  toolbarActions?: ReactNode;
  filterPanel?: ReactNode;
  className?: string;
  contentClassName?: string;
}

const VIEW_ICONS = {
  grid: Grid2X2,
  list: List,
  grouped: Shapes,
  folder: FolderTree,
} satisfies Record<CreativeAssetBrowserViewMode, typeof Grid2X2>;

export function CreativeAssetBrowser({
  children,
  query,
  onQueryChange,
  queryPlaceholder,
  empty,
  emptyMessage,
  kindFilters = [],
  activeKind,
  onKindChange,
  sourceFilters = [],
  activeSource,
  onSourceChange,
  tags = '',
  onTagsChange,
  dateFrom = '',
  dateTo = '',
  onDateFromChange,
  onDateToChange,
  semantic = false,
  onSemanticChange,
  viewMode = 'grid',
  viewModes = ['grid'],
  onViewModeChange,
  totalCount,
  selectedCount = 0,
  toolbarActions,
  filterPanel,
  className,
  contentClassName,
}: CreativeAssetBrowserProps) {
  const { t } = useLanguage();
  const searchCountedRef = useRef(false);
  const labels = t.creative.assetBrowser;
  const showViewModes = viewModes.length > 1 && onViewModeChange;
  const resultSummary =
    selectedCount > 0
      ? labels.selected.replace('{count}', String(selectedCount))
      : totalCount === undefined
        ? ''
        : labels.results.replace('{count}', String(totalCount));

  return (
    <section
      aria-label={labels.label}
      data-testid="creative-asset-browser"
      className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <label className="border-input bg-background flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3">
            <Search className="text-muted-foreground size-4" aria-hidden />
            <span className="sr-only">{labels.search}</span>
            <input
              value={query}
              onChange={(event) => {
                if (event.target.value.trim() && !searchCountedRef.current) {
                  searchCountedRef.current = true;
                  recordCreativeDebugCounter('asset.search.used');
                }
                onQueryChange(event.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              placeholder={queryPlaceholder}
            />
          </label>
          {sourceFilters.length > 0 && onSourceChange ? (
            <label className="border-input bg-background text-muted-foreground flex items-center gap-2 rounded-md border px-2 text-xs">
              <span>{labels.source}</span>
              <select
                value={activeSource}
                onChange={(event) => onSourceChange(event.target.value)}
                className="bg-transparent py-2 text-xs outline-none"
              >
                {sourceFilters.map((filter) => (
                  <option key={filter.id} value={filter.id}>
                    {filter.label}
                    {filter.count === undefined ? '' : ` (${filter.count})`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {onSemanticChange ? (
            <button
              type="button"
              aria-pressed={semantic}
              onClick={() => onSemanticChange(!semantic)}
              className={cn(
                'border-border rounded-md border px-2.5 py-2 text-xs font-medium',
                semantic
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {labels.semantic}
            </button>
          ) : null}
          {showViewModes ? (
            <div
              role="group"
              className="border-border flex rounded-md border p-0.5"
              aria-label={labels.viewMode}
            >
              {viewModes.map((mode) => {
                const Icon = VIEW_ICONS[mode];
                const active = viewMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-label={`${labels.viewMode}: ${viewModeLabel(
                      mode,
                      labels,
                    )}`}
                    aria-pressed={active}
                    onClick={() => onViewModeChange(mode)}
                    className={cn(
                      'inline-flex size-8 items-center justify-center rounded text-xs',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </button>
                );
              })}
            </div>
          ) : null}
          {toolbarActions}
        </div>

        {kindFilters.length > 0 && onKindChange ? (
          <div className="flex flex-wrap gap-1">
            {kindFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => onKindChange(filter.id)}
                aria-pressed={activeKind === filter.id}
                className={cn(
                  'border-border rounded-md border px-2.5 py-1.5 text-xs',
                  activeKind === filter.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {filter.label}
                {filter.count === undefined ? null : (
                  <span className="ml-1 tabular-nums">{filter.count}</span>
                )}
              </button>
            ))}
          </div>
        ) : null}

        {filterPanel}

        {onTagsChange || onDateFromChange || onDateToChange ? (
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            {onTagsChange ? (
              <label className="border-input bg-background flex min-w-0 items-center gap-2 rounded-md border px-3">
                <Tags className="text-muted-foreground size-3.5" aria-hidden />
                <span className="sr-only">{labels.tags}</span>
                <input
                  value={tags}
                  onChange={(event) => onTagsChange(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none"
                  placeholder={labels.tags}
                />
              </label>
            ) : null}
            {onDateFromChange ? (
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <span>{labels.from}</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => onDateFromChange(event.target.value)}
                  className="border-input bg-background rounded-md border px-2 py-1.5"
                />
              </label>
            ) : null}
            {onDateToChange ? (
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <span>{labels.to}</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => onDateToChange(event.target.value)}
                  className="border-input bg-background rounded-md border px-2 py-1.5"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {resultSummary ? (
          <p
            className="text-muted-foreground text-xs tabular-nums"
            aria-live="polite"
          >
            {resultSummary}
          </p>
        ) : null}
      </div>

      {empty ? (
        <div className="text-muted-foreground flex min-h-48 items-center justify-center rounded-md border border-dashed text-sm">
          {emptyMessage}
        </div>
      ) : (
        <div
          className={cn('min-h-0 flex-1 overflow-auto pr-1', contentClassName)}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function viewModeLabel(
  mode: CreativeAssetBrowserViewMode,
  labels: ReturnType<typeof useLanguage>['t']['creative']['assetBrowser'],
): string {
  if (mode === 'list') return labels.viewList;
  if (mode === 'grouped') return labels.viewGrouped;
  if (mode === 'folder') return labels.viewFolder;
  return labels.viewGrid;
}
