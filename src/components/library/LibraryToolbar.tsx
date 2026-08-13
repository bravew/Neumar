/**
 * LibraryToolbar — Search box, filter chips, sort dropdown, and select action bar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  Check,
  ChevronDown,
  Search,
  SortAsc,
  Square,
  SquareCheck,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';

import type { FilterOption, SortOption } from './library-utils';
import { getSortIcon } from './library-utils';

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterBy: FilterOption;
  onFilterChange: (filter: FilterOption) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  totalCount: number;
  selectedCount: number;
  statusCounts: Record<FilterOption, number>;
  onSelectAll: () => void;
  onDeleteSelected: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}

const FILTER_OPTIONS: FilterOption[] = [
  'all',
  'running',
  'completed',
  'error',
  'favorites',
];

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  filterBy,
  onFilterChange,
  sortBy,
  onSortChange,
  totalCount,
  selectedCount,
  statusCounts,
  onSelectAll,
  onDeleteSelected,
  t,
}: LibraryToolbarProps) {
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close sort dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(e.target as Node)
      ) {
        setShowSortDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sortLabels = useMemo<Record<SortOption, string>>(
    () => ({
      newest: t.library.sortNewest,
      oldest: t.library.sortOldest,
      'name-az': t.library.sortNameAZ,
      'name-za': t.library.sortNameZA,
      'recently-updated': t.library.sortRecentlyUpdated,
    }),
    [t],
  );

  const filterLabels = useMemo<Record<FilterOption, string>>(
    () => ({
      all: t.library.filterAll,
      running: t.library.filterRunning,
      completed: t.library.filterCompleted,
      error: t.library.filterError,
      favorites: t.library.filterFavorites,
    }),
    [t],
  );

  return (
    <>
      {/* Search Box */}
      <div className="relative mb-4">
        <Search
          className="text-muted-foreground absolute top-1/2 left-4 size-5 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.library.searchPlaceholder}
          aria-label={t.library.searchPlaceholder}
          className="border-primary/30 bg-background text-foreground placeholder:text-muted-foreground focus:border-primary h-12 w-full rounded-xl border-2 pr-10 pl-12 text-base transition-colors focus:outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded-full p-1 transition-colors"
            aria-label={t.library.searchPlaceholder}
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Filter Chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((key) => {
          const count = statusCounts[key];
          const isActive = filterBy === key;
          return (
            <button
              key={key}
              onClick={() => onFilterChange(key)}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              aria-label={`Filter by ${filterLabels[key]}`}
            >
              {filterLabels[key]}
              {count > 0 && (
                <span
                  className={cn(
                    'ml-0.5 min-w-5 rounded-full px-1 text-center text-xs',
                    isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted-foreground/10 text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Toolbar: Count + Sort */}
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <span className="text-muted-foreground text-sm">
          {(totalCount === 1
            ? t.library.chatsCount
            : t.library.chatsCountPlural
          ).replace('{count}', String(totalCount))}
        </span>

        {/* Sort Dropdown */}
        <div className="relative" ref={sortDropdownRef}>
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors"
            aria-label={`${t.library.sortBy}: ${sortLabels[sortBy]}`}
          >
            <SortAsc className="size-4" />
            <span className="hidden sm:inline">{sortLabels[sortBy]}</span>
            <ChevronDown className="size-3" />
          </button>

          <AnimatePresence>
            {showSortDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="bg-popover border-border absolute right-0 z-50 mt-1 w-52 rounded-lg border shadow-lg"
              >
                {(Object.entries(sortLabels) as [SortOption, string][]).map(
                  ([key, label]) => {
                    const SortIcon = getSortIcon(key);
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          onSortChange(key);
                          setShowSortDropdown(false);
                        }}
                        className={cn(
                          'hover:bg-accent flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors first:rounded-t-lg last:rounded-b-lg',
                          sortBy === key && 'text-primary font-medium',
                        )}
                      >
                        <SortIcon className="size-4" />
                        {label}
                        {sortBy === key && <Check className="ml-auto size-4" />}
                      </button>
                    );
                  },
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Select Action Bar — appears when tasks are selected */}
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-3 overflow-hidden"
          >
            <div className="bg-muted/60 flex items-center justify-between rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={onSelectAll}
                  className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-sm transition-colors"
                >
                  {selectedCount === totalCount ? (
                    <SquareCheck className="size-4" />
                  ) : (
                    <Square className="size-4" />
                  )}
                  {selectedCount === totalCount
                    ? t.library.deselectAll
                    : t.library.selectAll}
                </button>

                <span className="text-muted-foreground text-sm font-medium">
                  {t.library.selectedCount.replace(
                    '{count}',
                    String(selectedCount),
                  )}
                </span>
              </div>

              <button
                onClick={onDeleteSelected}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/20"
                aria-label={t.library.deleteSelected}
              >
                <Trash2 className="size-4" />
                {t.library.deleteSelected}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
