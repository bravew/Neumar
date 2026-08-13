/**
 * Search Provider Card
 *
 * Individual provider entry in the search settings list.
 * Shows name, description, toggle, API key input, and priority controls.
 */

import { useState } from 'react';

import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GripVertical,
} from 'lucide-react';

import type { SearchProviderEntry } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';

export interface ProviderPreset {
  id: string;
  name: string;
  descriptionKey: string;
  description: string;
  requiresApiKey: boolean;
  apiKeyUrl?: string;
  defaultBaseUrl?: string;
  extraConfigFields?: Array<{
    key: string;
    label: string;
    labelKey: string;
    placeholder: string;
    required: boolean;
  }>;
  defaultPriority: number;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    descriptionKey: 'search.provider.tavily.desc',
    description: 'AI-optimized search with high relevance, recommended',
    requiresApiKey: true,
    apiKeyUrl: 'https://app.tavily.com/home',
    defaultPriority: 10,
  },
  {
    id: 'exa',
    name: 'Exa',
    descriptionKey: 'search.provider.exa.desc',
    description: 'Semantic search, excellent for academic/deep content',
    requiresApiKey: true,
    apiKeyUrl: 'https://dashboard.exa.ai/api-keys',
    defaultPriority: 20,
  },
  {
    id: 'brave',
    name: 'Brave Search',
    descriptionKey: 'search.provider.brave.desc',
    description: 'Privacy-focused, independent index, no tracking',
    requiresApiKey: true,
    apiKeyUrl: 'https://api.search.brave.com/app/keys',
    defaultPriority: 25,
  },
  {
    id: 'perplexity',
    name: 'Perplexity Sonar',
    descriptionKey: 'search.provider.perplexity.desc',
    description: 'AI answers with citations',
    requiresApiKey: true,
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    defaultPriority: 30,
  },
  {
    id: 'serper',
    name: 'Serper',
    descriptionKey: 'search.provider.serper.desc',
    description: 'Fast Google search API, excellent cost/performance',
    requiresApiKey: true,
    apiKeyUrl: 'https://serper.dev/api-key',
    defaultPriority: 40,
  },
  {
    id: 'serpapi',
    name: 'SerpAPI',
    descriptionKey: 'search.provider.serpapi.desc',
    description: 'Google results API, 80+ engines',
    requiresApiKey: true,
    apiKeyUrl: 'https://serpapi.com/manage-api-key',
    defaultPriority: 50,
  },
  {
    id: 'jina',
    name: 'Jina Search',
    descriptionKey: 'search.provider.jina.desc',
    description: 'Search + URL-to-markdown, works without API key',
    requiresApiKey: false,
    apiKeyUrl: 'https://jina.ai/reader/',
    defaultPriority: 55,
  },
  {
    id: 'metaso',
    name: '秘塔搜索 (Metaso)',
    descriptionKey: 'search.provider.metaso.desc',
    description: 'Chinese AI search, strong Chinese content',
    requiresApiKey: true,
    defaultPriority: 45,
  },
  {
    id: 'google-cse',
    name: 'Google CSE',
    descriptionKey: 'search.provider.google-cse.desc',
    description: 'Google Custom Search, requires search engine ID',
    requiresApiKey: true,
    apiKeyUrl: 'https://programmablesearchengine.google.com/',
    extraConfigFields: [
      {
        key: 'searchEngineId',
        label: 'Search Engine ID',
        labelKey: 'search.provider.google-cse.searchEngineId',
        placeholder: 'cx=...',
        required: true,
      },
    ],
    defaultPriority: 70,
  },
  {
    id: 'you',
    name: 'You.com',
    descriptionKey: 'search.provider.you.desc',
    description: 'Web + news search with free livecrawl',
    requiresApiKey: true,
    apiKeyUrl: 'https://you.com/dashboard',
    defaultPriority: 35,
  },
  {
    id: 'yandex',
    name: 'Yandex Search',
    descriptionKey: 'search.provider.yandex.desc',
    description: 'Best for Russian and CIS region content',
    requiresApiKey: true,
    defaultPriority: 75,
  },
  {
    id: 'searxng',
    name: 'SearXNG',
    descriptionKey: 'search.provider.searxng.desc',
    description: 'Self-hosted meta search, aggregates 70+ providers',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8888',
    defaultPriority: 80,
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    descriptionKey: 'search.provider.duckduckgo.desc',
    description: 'Free fallback, limited to instant answers',
    requiresApiKey: false,
    defaultPriority: 100,
  },
];

export function ProviderCard({
  provider,
  preset,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
  t,
}: {
  provider: SearchProviderEntry;
  preset?: ProviderPreset;
  index: number;
  total: number;
  onUpdate: (patch: Partial<SearchProviderEntry>) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
  t: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'bg-muted/50 border-border rounded-lg border p-3 transition-colors',
        provider.enabled && 'border-primary/30',
      )}
    >
      <div className="flex items-center gap-2">
        {/* Move arrows */}
        <div className="flex flex-col">
          <button
            onClick={() => onMove('up')}
            disabled={index === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            onClick={() => onMove('down')}
            disabled={index === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>

        <GripVertical className="text-muted-foreground size-4" />

        {/* Name + Description */}
        <div
          className="flex-1 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="text-sm font-medium">{provider.name}</div>
          <div className="text-muted-foreground text-xs">
            {t[preset?.descriptionKey ?? ''] || preset?.description || ''}
          </div>
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={provider.enabled}
          onClick={() => onUpdate({ enabled: !provider.enabled })}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
            provider.enabled ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform',
              provider.enabled ? 'translate-x-4' : 'translate-x-0.5',
              'mt-0.5',
            )}
          />
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-2 pl-10">
          {/* API Key */}
          {preset?.requiresApiKey !== false && (
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={provider.apiKey}
                onChange={(e) => onUpdate({ apiKey: e.target.value })}
                placeholder="API Key"
                className="bg-background flex-1 rounded-md border px-2 py-1 text-xs"
              />
              {preset?.apiKeyUrl && (
                <a
                  href={preset.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary flex items-center gap-1 text-xs hover:underline"
                >
                  {t['search.getKey'] || 'Get Key'}
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          )}

          {!preset?.requiresApiKey && (
            <p className="text-muted-foreground text-xs italic">
              {t['search.noKeyRequired'] || 'No API key required'}
            </p>
          )}

          {/* Base URL (for self-hosted) */}
          {(preset?.defaultBaseUrl || provider.baseUrl) && (
            <div>
              <input
                type="text"
                value={provider.baseUrl ?? preset?.defaultBaseUrl ?? ''}
                onChange={(e) => onUpdate({ baseUrl: e.target.value })}
                placeholder="Base URL"
                className="bg-background w-full rounded-md border px-2 py-1 text-xs"
              />
            </div>
          )}

          {/* Extra config fields */}
          {preset?.extraConfigFields?.map((field) => (
            <div key={field.key}>
              <label className="text-muted-foreground text-xs">
                {t[field.labelKey] || field.label}
              </label>
              <input
                type="text"
                value={provider.config?.[field.key] ?? ''}
                onChange={(e) =>
                  onUpdate({
                    config: { ...provider.config, [field.key]: e.target.value },
                  })
                }
                placeholder={field.placeholder}
                className="bg-background mt-0.5 w-full rounded-md border px-2 py-1 text-xs"
              />
            </div>
          ))}

          {/* Remove */}
          <button
            onClick={onRemove}
            className="text-destructive text-xs hover:underline"
          >
            {t['search.removeProvider'] || 'Remove'}
          </button>
        </div>
      )}
    </div>
  );
}
