import { useMemo, useState } from 'react';

import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { ConnectorCard } from './ConnectorCard';
import type { ConnectorCatalogState } from './hooks/useConnectorCatalog';
import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import { ConnectorInput } from './parts';
import type { ConnectorDetail } from './types';

interface ConnectorCatalogGridProps {
  catalog: ConnectorCatalogState;
  messages?: ConnectorMessages;
  hiddenConnectorIds?: readonly string[];
  onOpen: (id: string) => void;
}

type Filter = 'all' | 'connected' | 'available' | 'recommended' | 'native';
type Sort = 'recommended' | 'name' | 'tools';

const SUGGESTED_CONNECTOR_IDS = [
  'github',
  'notion',
  'linear',
  'slack',
  'stripe',
  'airtable',
  'asana',
  'jira',
  'confluence',
  'hubspot',
  'salesforce',
  'figma',
] as const;
const SUGGESTED = new Set<string>(SUGGESTED_CONNECTOR_IDS);
const SUGGESTED_ORDER = new Map<string, number>(
  SUGGESTED_CONNECTOR_IDS.map((id, index) => [id, index]),
);
const EMPTY_HIDDEN_CONNECTOR_IDS: readonly string[] = [];

export function ConnectorCatalogGrid({
  catalog,
  messages = defaultConnectorMessages,
  hiddenConnectorIds = EMPTY_HIDDEN_CONNECTOR_IDS,
  onOpen,
}: ConnectorCatalogGridProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('recommended');
  const [sort, setSort] = useState<Sort>('recommended');
  const hasQuery = query.trim().length > 0;

  const connectors = useMemo(
    () =>
      rankConnectors(
        catalog.connectors,
        query,
        filter,
        sort,
        hiddenConnectorIds,
      ),
    [catalog.connectors, filter, hiddenConnectorIds, query, sort],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <ConnectorInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !query) return;
              event.preventDefault();
              setQuery('');
            }}
            placeholder={messages.catalog.searchPlaceholder}
            aria-label={messages.catalog.searchLabel}
            className="pr-9 pl-9"
          />
          {hasQuery && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={messages.catalog.searchClear}
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
              onClick={() => setQuery('')}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            ['all', 'connected', 'available', 'recommended', 'native'] as const
          ).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              aria-label={messages.catalog.filterAriaLabel.replace(
                '{filter}',
                messages.catalog.filters[value],
              )}
              variant={filter === value ? 'default' : 'outline'}
              onClick={() => setFilter(value)}
            >
              {messages.catalog.filters[value]}
            </Button>
          ))}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="border-input bg-background rounded-md border px-2 text-sm"
            aria-label={messages.catalog.sortLabel}
          >
            <option value="recommended">
              {messages.catalog.sortRecommended}
            </option>
            <option value="name">{messages.catalog.sortName}</option>
            <option value="tools">{messages.catalog.sortTools}</option>
          </select>
        </div>
      </div>
      {catalog.loading && (
        <p className="text-muted-foreground text-sm">
          {messages.catalog.loading}
        </p>
      )}
      {catalog.error && <p className="text-sm text-red-600">{catalog.error}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {connectors.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            messages={messages}
            onOpen={onOpen}
          />
        ))}
      </div>
      {!catalog.loading && connectors.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {messages.catalog.empty}
        </p>
      )}
    </section>
  );
}

function rankConnectors(
  connectors: ConnectorDetail[],
  query: string,
  filter: Filter,
  sort: Sort,
  hiddenConnectorIds: readonly string[],
): ConnectorDetail[] {
  const q = query.trim().toLowerCase();
  const searched = connectors
    .filter((connector) => {
      if (hiddenConnectorIds.includes(connector.id)) return false;
      if (!q) return true;
      return getConnectorSearchScore(connector, q) !== null;
    })
    .filter((connector) => {
      if (filter === 'connected') return connector.status === 'connected';
      if (filter === 'available') return connector.status === 'available';
      if (filter === 'native') return connector.provider === 'native';
      if (filter === 'recommended' && !q) {
        return connector.status === 'connected' || SUGGESTED.has(connector.id);
      }
      return true;
    });

  if (q) {
    return searched
      .map((connector) => ({
        connector,
        score: getConnectorSearchScore(connector, q) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return compareConnectorPriority(a.connector, b.connector);
      })
      .map((entry) => entry.connector);
  }

  return searched.sort((a, b) => {
    if (sort === 'name') return compareConnectorName(a, b);
    if (sort === 'tools') {
      const toolsDelta = (b.toolCount ?? 0) - (a.toolCount ?? 0);
      return toolsDelta || compareConnectorPriority(a, b);
    }
    return compareConnectorPriority(a, b);
  });
}

function normalizedSearchValue(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function scoreConnectorText(
  value: string | undefined,
  query: string,
  baseScore: number,
): number | null {
  const normalized = normalizedSearchValue(value);
  if (!normalized) return null;
  if (normalized === query) return baseScore;
  if (normalized.startsWith(query)) return baseScore + 1;
  if (normalized.includes(query)) return baseScore + 2;
  return null;
}

function getConnectorSearchScore(
  connector: ConnectorDetail,
  query: string,
): number | null {
  const scores: number[] = [];
  const collect = (value: string | undefined, baseScore: number) => {
    const score = scoreConnectorText(value, query, baseScore);
    if (score !== null) scores.push(score);
  };

  collect(connector.name, 0);
  collect(connector.provider, 0);
  collect(connector.id, 1);
  collect(connector.category, 3);
  collect(connector.accountLabel, 3);

  for (const tool of connector.tools) {
    collect(tool.title, 5);
    collect(tool.name, 5);
  }

  collect(connector.description, 8);
  for (const tool of connector.tools) {
    collect(tool.description, 8);
  }

  // Avoid `Math.min(...scores)` — the spread can blow the call stack for
  // connectors with many tools, and `scores` is unbounded here.
  if (scores.length === 0) return null;
  let best = scores[0];
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] < best) best = scores[i];
  }
  return best;
}

function compareConnectorPriority(
  a: ConnectorDetail,
  b: ConnectorDetail,
): number {
  const aConnected = a.status === 'connected';
  const bConnected = b.status === 'connected';
  if (aConnected !== bConnected) return aConnected ? -1 : 1;

  const aSuggested = SUGGESTED.has(a.id);
  const bSuggested = SUGGESTED.has(b.id);
  if (aSuggested !== bSuggested) return aSuggested ? -1 : 1;

  const aOrder = SUGGESTED_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const bOrder = SUGGESTED_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;

  return compareConnectorName(a, b);
}

function compareConnectorName(a: ConnectorDetail, b: ConnectorDetail): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  );
}
