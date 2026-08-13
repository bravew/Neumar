import { useEffect, useRef, useState } from 'react';

import { ChevronLeft, Search, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  findNavItem,
  SETTINGS_NAV,
  type SettingsNavItem,
  type SettingsNavItemId,
} from './navigation';
import type { SettingsCategory } from './types';

interface SettingsNavProps {
  activeCategory: SettingsCategory;
  onSelectCategory: (category: SettingsCategory) => void;
  onClose: () => void;
}

interface SearchResult {
  item: SettingsNavItem;
  category: SettingsCategory;
  /** True when the match is a sub-tab rather than the item itself */
  isSubTab: boolean;
}

export function SettingsNav({
  activeCategory,
  onSelectCategory,
  onClose,
}: SettingsNavProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  // Remember the last visited sub-tab per nav item so switching items restores it
  const lastCategoryByItem = useRef<
    Partial<Record<SettingsNavItemId, SettingsCategory>>
  >({});

  const settingsLabels = t.settings as Record<string, string>;
  const getLabel = (key: string): string => settingsLabels[key] ?? key;
  const getCategoryLabel = (id: SettingsCategory): string => t.settings[id];

  const activeItem = findNavItem(activeCategory);
  useEffect(() => {
    lastCategoryByItem.current[findNavItem(activeCategory).id] = activeCategory;
  }, [activeCategory]);

  const selectCategory = (category: SettingsCategory) => {
    onSelectCategory(category);
    setQuery('');
  };

  const selectItem = (item: SettingsNavItem) => {
    selectCategory(lastCategoryByItem.current[item.id] ?? item.categories[0]);
  };

  // Cheap enough to recompute each render (~26 label comparisons)
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults: SearchResult[] = [];
  if (normalizedQuery) {
    for (const group of SETTINGS_NAV) {
      for (const item of group.items) {
        const itemMatches = getLabel(item.labelKey)
          .toLowerCase()
          .includes(normalizedQuery);
        if (itemMatches) {
          searchResults.push({
            item,
            category: item.categories[0],
            isSubTab: false,
          });
        }
        for (const category of item.categories) {
          const label = getCategoryLabel(category);
          if (
            label.toLowerCase().includes(normalizedQuery) &&
            !(itemMatches && category === item.categories[0])
          ) {
            searchResults.push({
              item,
              category,
              isSubTab: item.categories.length > 1,
            });
          }
        }
      }
    }
  }

  return (
    <div className="border-border bg-muted/30 flex w-60 shrink-0 flex-col border-r">
      {/* Back / Title header */}
      <div className="px-4 pt-5 pb-3">
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-sm transition-colors"
        >
          <ChevronLeft className="size-4" />
          <span className="text-foreground text-lg font-semibold">
            {t.settings.title}
          </span>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <label className="border-input bg-background focus-within:ring-ring flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm focus-within:ring-1">
          <Search className="text-muted-foreground size-3.5 shrink-0" />
          <input
            data-testid="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder={getLabel('searchSettings')}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Clear"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
      </div>

      {/* Navigation Items */}
      <nav
        data-testid="settings-nav"
        className="flex-1 overflow-y-auto px-2 pb-2"
      >
        {normalizedQuery ? (
          searchResults.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-sm">
              {getLabel('searchNoResults')}
            </p>
          ) : (
            <div className="space-y-0.5 pt-1">
              {searchResults.map(({ item, category, isSubTab }) => {
                const Icon = item.icon;
                return (
                  <button
                    key={`${item.id}-${category}`}
                    onClick={() => selectCategory(category)}
                    className="text-foreground/70 hover:bg-accent/50 hover:text-foreground flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {isSubTab
                        ? getCategoryLabel(category)
                        : getLabel(item.labelKey)}
                    </span>
                    {isSubTab && (
                      <span className="text-muted-foreground max-w-[40%] truncate text-xs">
                        {getLabel(item.labelKey)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : (
          SETTINGS_NAV.map((group) => (
            <div key={group.id}>
              {group.labelKey && (
                <div className="text-muted-foreground px-3 pt-4 pb-1 text-[11px] font-medium tracking-wider uppercase">
                  {getLabel(group.labelKey)}
                </div>
              )}
              <div className="space-y-0.5 pt-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === activeItem.id;
                  return (
                    <button
                      key={item.id}
                      data-testid={`settings-nav-${item.id}`}
                      onClick={() => selectItem(item)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200 focus:outline-none focus-visible:outline-none',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="flex-1 text-left">
                        {getLabel(item.labelKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
