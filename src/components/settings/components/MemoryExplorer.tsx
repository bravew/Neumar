/**
 * MemoryExplorer — comprehensive memory search, inspection, and health dashboard.
 *
 * Three tabs: Search (semantic/text with filters), Health (analytics dashboard),
 * Entities (extracted entity list). Sub-components in MemoryExplorerParts.tsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Activity,
  Brain,
  Database,
  Filter,
  Layers,
  Link2,
  Loader2,
  Search,
  Sparkles,
  Type,
  Users,
  Zap,
} from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  Badge,
  CATEGORIES,
  INPUT_CLASS,
  LIFECYCLE_COLORS,
  LIFECYCLE_STATUSES,
  MEMORY_TYPES,
  MemoryDetailPanel,
  SCOPE_TYPES,
  StatCard,
  StrengthBar,
  strengthPercent,
  timeAgo,
  TYPE_COLORS,
} from './MemoryExplorerParts';
import type {
  EntityItem,
  MemoryAnalytics,
  MemoryV2,
  SearchResult,
} from './MemoryExplorerParts';

export function MemoryExplorer() {
  const { t } = useLanguage();

  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'text' | 'semantic'>('semantic');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [listResults, setListResults] = useState<MemoryV2[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [filterScope, setFilterScope] = useState<string>('');
  const [filterLifecycle, setFilterLifecycle] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');

  const [selectedMemory, setSelectedMemory] = useState<MemoryV2 | null>(null);
  const [analytics, setAnalytics] = useState<MemoryAnalytics | null>(null);
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'health' | 'entities'>(
    'search',
  );

  // Load analytics + entities on mount
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [aRes, eRes] = await Promise.all([
          fetch(`${API_BASE_URL}/memory/analytics`, {
            signal: controller.signal,
          }),
          fetch(`${API_BASE_URL}/memory/entities?limit=50`, {
            signal: controller.signal,
          }),
        ]);
        if (aRes.ok) setAnalytics(await aRes.json());
        if (eRes.ok) {
          const data = await eRes.json();
          setEntities(data.entities ?? []);
        }
      } catch {
        /* backend not available */
      }
    }
    load();
    return () => controller.abort();
  }, []);

  // Abort in-flight search on unmount
  useEffect(() => () => searchAbortRef.current?.abort(), []);

  // Search handler
  const doSearch = useCallback(
    async (q: string) => {
      // Abort any in-flight search to prevent stale responses
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const { signal } = controller;

      if (!q.trim()) {
        setResults([]);
        try {
          setSearching(true);
          const params = new URLSearchParams({
            limit: '20',
            sortBy: 'created_at',
            sortOrder: 'desc',
          });
          if (filterType) params.set('memoryType', filterType);
          if (filterScope) params.set('scopeType', filterScope);
          if (filterLifecycle) params.set('lifecycleStatus', filterLifecycle);
          if (filterCategory) params.set('category', filterCategory);
          const res = await fetch(`${API_BASE_URL}/memory?${params}`, {
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            setListResults(data.memories ?? []);
          }
        } catch {
          /* aborted or failed */
        } finally {
          setSearching(false);
        }
        return;
      }

      setSearching(true);
      try {
        if (searchMode === 'semantic') {
          const body: Record<string, unknown> = { query: q, limit: 20 };
          if (filterType) body.memoryType = filterType;
          if (filterCategory) body.category = filterCategory;
          if (filterLifecycle) body.lifecycleStatus = filterLifecycle;
          const res = await fetch(`${API_BASE_URL}/memory/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            setResults(data.results ?? []);
            setListResults([]);
          }
        } else {
          const params = new URLSearchParams({
            search: q,
            limit: '20',
            sortBy: 'created_at',
            sortOrder: 'desc',
          });
          if (filterType) params.set('memoryType', filterType);
          if (filterScope) params.set('scopeType', filterScope);
          if (filterLifecycle) params.set('lifecycleStatus', filterLifecycle);
          if (filterCategory) params.set('category', filterCategory);
          const res = await fetch(`${API_BASE_URL}/memory?${params}`, {
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            setListResults(data.memories ?? []);
            setResults([]);
          }
        }
      } catch {
        /* */
      } finally {
        setSearching(false);
      }
    },
    [searchMode, filterType, filterScope, filterLifecycle, filterCategory],
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // Re-search when filters change
  useEffect(() => {
    doSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterScope, filterLifecycle, filterCategory]);

  const handlePin = useCallback(
    async (id: string, unpin: boolean) => {
      try {
        const endpoint = unpin ? 'unpin' : 'pin';
        const res = await fetch(`${API_BASE_URL}/memory/${id}/${endpoint}`, {
          method: 'POST',
        });
        if (res.ok) {
          const updated = await res.json();
          setSelectedMemory(updated);
          doSearch(query);
        }
      } catch {
        /* */
      }
    },
    [query, doSearch],
  );

  const displayItems: { memory: MemoryV2; score?: number }[] =
    results.length > 0 ? results : listResults.map((m) => ({ memory: m }));
  const hasActiveFilters =
    filterType || filterScope || filterLifecycle || filterCategory;

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="border-border flex gap-1 border-b pb-1">
        {(
          [
            ['search', Search, t.settings.memorySearch ?? 'Search'],
            ['health', Activity, t.settings.memoryAnalytics ?? 'Analytics'],
            ['entities', Link2, t.settings.memoryEntities ?? 'Entities'],
          ] as const
        ).map(([tab, Icon, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Search Tab ── */}
      {activeTab === 'search' && (
        <SearchTab
          query={query}
          setQuery={setQuery}
          searchMode={searchMode}
          setSearchMode={setSearchMode}
          searching={searching}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          filterType={filterType}
          setFilterType={setFilterType}
          filterScope={filterScope}
          setFilterScope={setFilterScope}
          filterLifecycle={filterLifecycle}
          setFilterLifecycle={setFilterLifecycle}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          hasActiveFilters={!!hasActiveFilters}
          displayItems={displayItems}
          selectedMemory={selectedMemory}
          setSelectedMemory={setSelectedMemory}
          onPin={handlePin}
        />
      )}

      {/* ── Health Tab ── */}
      {activeTab === 'health' &&
        (analytics ? (
          <HealthTab analytics={analytics} />
        ) : (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-muted-foreground animate-spin" />
          </div>
        ))}

      {/* ── Entities Tab ── */}
      {activeTab === 'entities' && <EntitiesTab entities={entities} />}
    </div>
  );
}

// ── Search Tab (extracted to stay under line limit) ──

function SearchTab({
  query,
  setQuery,
  searchMode,
  setSearchMode,
  searching,
  showFilters,
  setShowFilters,
  filterType,
  setFilterType,
  filterScope,
  setFilterScope,
  filterLifecycle,
  setFilterLifecycle,
  filterCategory,
  setFilterCategory,
  hasActiveFilters,
  displayItems,
  selectedMemory,
  setSelectedMemory,
  onPin,
}: {
  query: string;
  setQuery: (q: string) => void;
  searchMode: 'text' | 'semantic';
  setSearchMode: (m: 'text' | 'semantic') => void;
  searching: boolean;
  showFilters: boolean;
  setShowFilters: (v: boolean) => void;
  filterType: string;
  setFilterType: (v: string) => void;
  filterScope: string;
  setFilterScope: (v: string) => void;
  filterLifecycle: string;
  setFilterLifecycle: (v: string) => void;
  filterCategory: string;
  setFilterCategory: (v: string) => void;
  hasActiveFilters: boolean;
  displayItems: { memory: MemoryV2; score?: number }[];
  selectedMemory: MemoryV2 | null;
  setSelectedMemory: (m: MemoryV2 | null) => void;
  onPin: (id: string, unpin: boolean) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              t.settings.memorySearchPlaceholder ?? 'Search memories...'
            }
            className={cn(INPUT_CLASS, 'pl-9')}
          />
          {searching && (
            <Loader2
              size={14}
              className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 animate-spin"
            />
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            setSearchMode(searchMode === 'semantic' ? 'text' : 'semantic')
          }
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors',
            searchMode === 'semantic'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground',
          )}
          title={
            searchMode === 'semantic'
              ? (t.settings.memorySemanticSearchTooltip ??
                'Semantic similarity search')
              : (t.settings.memoryTextSearchTooltip ?? 'Exact text search')
          }
        >
          {searchMode === 'semantic' ? (
            <Sparkles size={12} />
          ) : (
            <Type size={12} />
          )}
          {searchMode === 'semantic'
            ? (t.settings.memorySemanticSearch ?? 'Semantic')
            : (t.settings.memoryTextSearch ?? 'Text')}
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors',
            hasActiveFilters
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          <Filter size={12} />
          {hasActiveFilters && (
            <span className="bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-full text-[10px]">
              {
                [
                  filterType,
                  filterScope,
                  filterLifecycle,
                  filterCategory,
                ].filter(Boolean).length
              }
            </span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-muted/30 grid grid-cols-2 gap-2 rounded-lg p-3 sm:grid-cols-4">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className={cn(INPUT_CLASS, 'text-xs')}
            aria-label={t.settings.memoryFilterAllTypes ?? 'Filter by type'}
          >
            <option value="">
              {t.settings.memoryFilterAllTypes ?? 'All Types'}
            </option>
            {MEMORY_TYPES.map((mt) => (
              <option key={mt} value={mt}>
                {mt}
              </option>
            ))}
          </select>
          <select
            value={filterScope}
            onChange={(e) => setFilterScope(e.target.value)}
            className={cn(INPUT_CLASS, 'text-xs')}
            aria-label={t.settings.memoryFilterAllScopes ?? 'Filter by scope'}
          >
            <option value="">
              {t.settings.memoryFilterAllScopes ?? 'All Scopes'}
            </option>
            {SCOPE_TYPES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <select
            value={filterLifecycle}
            onChange={(e) => setFilterLifecycle(e.target.value)}
            className={cn(INPUT_CLASS, 'text-xs')}
            aria-label={
              t.settings.memoryFilterAllStatuses ?? 'Filter by status'
            }
          >
            <option value="">
              {t.settings.memoryFilterAllStatuses ?? 'All Statuses'}
            </option>
            {LIFECYCLE_STATUSES.map((ls) => (
              <option key={ls} value={ls}>
                {ls}
              </option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className={cn(INPUT_CLASS, 'text-xs')}
            aria-label="Filter by category"
          >
            <option value="">
              {t.settings.memoryFilterAllCategories ?? 'All Categories'}
            </option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setFilterType('');
                setFilterScope('');
                setFilterLifecycle('');
                setFilterCategory('');
              }}
              className="text-muted-foreground hover:text-foreground col-span-full text-xs underline"
            >
              {t.settings.memoryClearFilters ?? 'Clear filters'}
            </button>
          )}
        </div>
      )}

      {/* Results */}
      <div className="memory-explorer-results flex gap-0">
        <div className={cn('min-w-0 flex-1', selectedMemory && 'max-w-[55%]')}>
          {displayItems.length === 0 && !searching && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {query
                ? (t.settings.memoryNoResults ??
                  'No memories match your search')
                : (t.settings.memoryNoMemories ?? 'No memories stored yet')}
            </p>
          )}
          <div className="space-y-1">
            {displayItems.map(({ memory, score }) => (
              <button
                key={memory.id}
                type="button"
                onClick={() => setSelectedMemory(memory)}
                className={cn(
                  'hover:bg-muted/50 w-full rounded-md p-2.5 text-left transition-colors',
                  selectedMemory?.id === memory.id &&
                    'bg-muted/70 ring-primary/30 ring-1',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground line-clamp-2 text-sm leading-snug">
                      {memory.content}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <Badge
                        className={cn(
                          'text-[10px]',
                          TYPE_COLORS[memory.memoryType] ?? '',
                        )}
                      >
                        {memory.memoryType}
                      </Badge>
                      <Badge className="bg-muted text-[10px]">
                        {memory.category}
                      </Badge>
                      {score !== undefined && (
                        <span className="text-muted-foreground text-[10px]">
                          {Math.round(score * 100)}%
                        </span>
                      )}
                      <span className="text-muted-foreground/60 text-[10px]">
                        {timeAgo(memory.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="w-10 shrink-0 pt-0.5">
                    <StrengthBar percent={strengthPercent(memory)} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        {selectedMemory && (
          <div className="memory-explorer-detail w-[45%] shrink-0">
            <MemoryDetailPanel
              memory={selectedMemory}
              onClose={() => setSelectedMemory(null)}
              onPin={onPin}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Health Tab ──

function HealthTab({ analytics }: { analytics: MemoryAnalytics }) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label={t.settings.memoryTotal ?? 'Total Memories'}
          value={analytics.total}
          icon={Database}
        />
        <StatCard
          label={t.settings.memoryWithEmbeddings ?? 'With Embeddings'}
          value={analytics.withEmbeddings}
          icon={Brain}
          color="bg-blue-500/10 text-blue-600"
        />
        <StatCard
          label={t.settings.memoryEntities ?? 'Entities'}
          value={analytics.entities?.totalEntities ?? 0}
          icon={Users}
          color="bg-purple-500/10 text-purple-600"
        />
        <StatCard
          label={t.settings.memoryRelationships ?? 'Relationships'}
          value={analytics.entities?.totalEdges ?? 0}
          icon={Link2}
          color="bg-green-500/10 text-green-600"
        />
      </div>

      {analytics.byType && Object.keys(analytics.byType).length > 0 && (
        <div className="bg-muted/30 rounded-lg p-3">
          <h5 className="text-foreground mb-2 text-xs font-medium">
            {t.settings.memoryTypeDistribution ?? 'Type Distribution'}
          </h5>
          <div className="space-y-1.5">
            {Object.entries(analytics.byType).map(([type, count]) => {
              const pct =
                analytics.total > 0 ? (count / analytics.total) * 100 : 0;
              return (
                <div key={type} className="flex items-center gap-2 text-xs">
                  <Badge
                    className={cn(
                      'w-20 justify-center text-[10px]',
                      TYPE_COLORS[type] ?? '',
                    )}
                  >
                    {type}
                  </Badge>
                  <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary/60 h-full rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground w-8 text-right">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analytics.byLifecycle &&
        Object.keys(analytics.byLifecycle).length > 0 && (
          <div className="bg-muted/30 rounded-lg p-3">
            <h5 className="text-foreground mb-2 text-xs font-medium">
              {t.settings.memoryLifecycleStatus ?? 'Lifecycle Status'}
            </h5>
            <div className="flex gap-3">
              {Object.entries(analytics.byLifecycle).map(([status, count]) => (
                <div key={status} className="flex items-center gap-1.5 text-xs">
                  <Badge
                    className={cn(
                      'text-[10px]',
                      LIFECYCLE_COLORS[status] ?? '',
                    )}
                  >
                    {status}
                  </Badge>
                  <span className="text-foreground font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      {analytics.byCategory && Object.keys(analytics.byCategory).length > 0 && (
        <div className="bg-muted/30 rounded-lg p-3">
          <h5 className="text-foreground mb-2 text-xs font-medium">
            {t.settings.memoryCategories ?? 'Categories'}
          </h5>
          <div className="flex flex-wrap gap-2">
            {Object.entries(analytics.byCategory).map(([cat, count]) => (
              <div
                key={cat}
                className="bg-muted flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
              >
                <span className="text-foreground capitalize">{cat}</span>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {analytics.consolidation?.lastRun && (
        <div className="bg-muted/30 rounded-lg p-3">
          <h5 className="text-foreground mb-1 text-xs font-medium">
            {t.settings.memoryLastConsolidation ?? 'Last Consolidation'}
          </h5>
          <p className="text-muted-foreground text-xs">
            {timeAgo(analytics.consolidation.lastRun.runAt)} —{' '}
            {analytics.consolidation.lastRun.memoriesMerged}{' '}
            {t.settings.memoryMemoriesMerged ?? 'memories merged'}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Entities Tab ──

function EntitiesTab({ entities }: { entities: EntityItem[] }) {
  const { t } = useLanguage();

  if (entities.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t.settings.memoryNoEntities ??
          'No entities extracted yet. Enable entity extraction in settings.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entities.map((entity) => (
        <div
          key={entity.id}
          className="bg-muted/30 flex items-center gap-3 rounded-lg p-3"
        >
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-md text-xs font-medium',
              entity.entityType === 'person' && 'bg-blue-500/15 text-blue-600',
              entity.entityType === 'project' &&
                'bg-green-500/15 text-green-600',
              entity.entityType === 'technology' &&
                'bg-orange-500/15 text-orange-600',
              entity.entityType === 'organization' &&
                'bg-purple-500/15 text-purple-600',
              entity.entityType === 'concept' && 'bg-gray-500/15 text-gray-600',
            )}
          >
            {entity.entityType === 'person' ? (
              <Users size={14} />
            ) : entity.entityType === 'technology' ? (
              <Zap size={14} />
            ) : (
              <Layers size={14} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-sm font-medium">
              {entity.name}
            </p>
            {entity.summary && (
              <p className="text-muted-foreground truncate text-xs">
                {entity.summary}
              </p>
            )}
          </div>
          <div className="text-right text-xs">
            <Badge className="bg-muted text-[10px]">{entity.entityType}</Badge>
            <p className="text-muted-foreground mt-0.5">
              {entity.mentionCount}x · {timeAgo(entity.lastSeenAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
