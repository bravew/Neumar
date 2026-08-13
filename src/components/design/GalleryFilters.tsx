import { Search } from 'lucide-react';

export interface GalleryFilterOption {
  label: string;
  value: string;
}

export interface GallerySelectFilter {
  allLabel: string;
  label: string;
  onChange: (value: string) => void;
  options: GalleryFilterOption[];
  testId?: string;
  value: string;
}

export function GalleryFilters({
  query,
  queryPlaceholder,
  onQueryChange,
  filters = [],
  className = '',
  searchTestId,
}: {
  query: string;
  queryPlaceholder: string;
  onQueryChange: (value: string) => void;
  filters?: GallerySelectFilter[];
  className?: string;
  searchTestId?: string;
}) {
  const visibleFilters = filters.filter((filter) => filter.options.length > 0);
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <label className="design-system-search-field border-input flex h-9 min-w-64 flex-1 items-center gap-2 rounded-md border px-3">
        <Search className="design-system-search-icon text-muted-foreground size-4" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={queryPlaceholder}
          aria-label={queryPlaceholder}
          data-testid={searchTestId}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {visibleFilters.map((filter) => (
        <select
          key={filter.label}
          value={filter.value}
          onChange={(event) => filter.onChange(event.target.value)}
          aria-label={filter.label}
          data-testid={filter.testId}
          className="border-input bg-background h-9 min-w-40 rounded-md border px-3 text-sm"
        >
          <option value="all">{filter.allLabel}</option>
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
