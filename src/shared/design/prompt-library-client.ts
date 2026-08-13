import { API_BASE_URL, SITE_API_BASE_URL } from '@/config';
import type {
  PromptLibraryFilters,
  PromptLibraryResult,
  PromptLibrarySample,
  PromptLibrarySurface,
} from '@/shared/design/prompt-library-types';
import type { PromptTemplateSnapshot } from '@/shared/types/design-mode';

const CACHE_TTL_MS = 60_000;
const DEFAULT_LIMIT = 50;
const PROMPT_ASPECTS = new Set<NonNullable<PromptTemplateSnapshot['aspect']>>([
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '4:5',
  '5:4',
  '2:3',
  '3:2',
  '21:9',
]);

const cache = new Map<
  string,
  { expiresAt: number; result: PromptLibraryResult }
>();

interface SitePromptSample {
  id: string;
  surface: PromptLibrarySurface;
  title: string;
  prompt: string;
  summary?: string;
  category?: string;
  tags?: string[];
  model?: string;
  aspect?: string;
  negativePrompt?: string;
  seed?: string;
  steps?: number;
  cfgScale?: string;
  sampler?: string;
  durationSec?: string;
  fps?: number;
  parameters?: Record<string, unknown>;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  source?: PromptTemplateSnapshot['source'];
  _meta?: {
    accountId?: string;
    label?: string;
    locales?: string[];
    repoSlug?: string;
    repoVisibility?: 'platform' | 'team';
    sampleId?: string;
    version?: string;
  };
}

export async function listPromptLibrarySamples(
  filters: PromptLibraryFilters = {},
  init?: RequestInit,
): Promise<PromptLibraryResult> {
  const normalized = normalizeFilters(filters);
  const cacheKey = JSON.stringify(normalized);
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const result = await fetchPromptLibrarySamples(normalized, init);
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });

  return result;
}

async function fetchPromptLibrarySamples(
  filters: Required<Pick<PromptLibraryFilters, 'limit' | 'surface'>> &
    PromptLibraryFilters,
  init?: RequestInit,
) {
  if (SITE_API_BASE_URL) {
    try {
      return await fetchSiteSamples(filters, init);
    } catch (error) {
      if (isAbort(error)) throw error;
    }
  }

  return fetchBuiltInSamples(filters, init);
}

async function fetchSiteSamples(
  filters: Required<Pick<PromptLibraryFilters, 'limit' | 'surface'>> &
    PromptLibraryFilters,
  init?: RequestInit,
): Promise<PromptLibraryResult> {
  const url = new URL('/api/v1/prompt-samples', SITE_API_BASE_URL);

  appendParams(url, filters);

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(filters.locale ? { 'Accept-Language': filters.locale } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 403 && (await isFeatureDisabled(response))) {
      return fetchBuiltInSamples(filters, init);
    }
    if (response.status >= 500) {
      return fetchBuiltInSamples(filters, init);
    }
    throw new Error(`Prompt library request failed (${response.status})`);
  }

  const data = (await response.json()) as {
    generatedAt?: string;
    items?: SitePromptSample[];
    nextCursor?: string;
  };

  return {
    generatedAt: data.generatedAt,
    items: (data.items ?? []).map(siteSampleToLibrarySample),
    nextCursor: data.nextCursor,
    offline: false,
  };
}

async function isFeatureDisabled(response: Response) {
  try {
    const data = (await response.clone().json()) as { error?: string };

    return data.error === 'feature_disabled';
  } catch {
    return false;
  }
}

async function fetchBuiltInSamples(
  filters: Required<Pick<PromptLibraryFilters, 'limit' | 'surface'>> &
    PromptLibraryFilters,
  init?: RequestInit,
): Promise<PromptLibraryResult> {
  const response = await fetch(
    `${API_BASE_URL}/design/prompt-templates?surface=${filters.surface}`,
    init,
  );

  if (!response.ok) {
    throw new Error(`Built-in prompt templates failed (${response.status})`);
  }

  const data = (await response.json()) as {
    templates?: PromptTemplateSnapshot[];
  };
  const filtered = filterBuiltInTemplates(data.templates ?? [], filters).slice(
    0,
    filters.limit,
  );
  const detailResults = await Promise.allSettled(
    filtered.map((template) => fetchBuiltInDetail(template, init)),
  );
  const items = detailResults.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : builtInTemplateToSample(filtered[index]!),
  );

  return {
    generatedAt: new Date().toISOString(),
    items,
    offline: true,
  };
}

async function fetchBuiltInDetail(
  template: PromptTemplateSnapshot,
  init?: RequestInit,
) {
  const response = await fetch(
    `${API_BASE_URL}/design/prompt-templates/${template.surface}/${encodeURIComponent(
      template.id,
    )}`,
    init,
  );

  if (!response.ok) {
    return builtInTemplateToSample(template);
  }

  const data = (await response.json()) as { template?: PromptTemplateSnapshot };

  return builtInTemplateToSample(data.template ?? template);
}

function appendParams(
  url: URL,
  filters: Required<Pick<PromptLibraryFilters, 'limit' | 'surface'>> &
    PromptLibraryFilters,
) {
  url.searchParams.set('surface', filters.surface);
  url.searchParams.set('limit', String(filters.limit));
  for (const key of ['category', 'locale', 'model', 'q', 'tag'] as const) {
    const value = filters[key];
    if (value) url.searchParams.set(key, value);
  }
}

function filterBuiltInTemplates(
  templates: PromptTemplateSnapshot[],
  filters: PromptLibraryFilters,
) {
  const q = filters.q?.toLowerCase();

  return templates.filter((template) => {
    if (filters.model && template.model !== filters.model) return false;
    if (filters.tag && !(template.tags ?? []).includes(filters.tag)) {
      return false;
    }
    if (filters.category && template.category !== filters.category) {
      return false;
    }
    if (!q) return true;

    return [
      template.title,
      template.summary,
      template.category,
      template.model,
      template.prompt,
      ...(template.tags ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(q));
  });
}

function siteSampleToLibrarySample(
  sample: SitePromptSample,
): PromptLibrarySample {
  const meta = sample._meta ?? {};
  const repoSlug = meta.repoSlug ?? 'platform';

  return {
    id: `${repoSlug}:${sample.id}`,
    surface: sample.surface,
    title: sample.title,
    prompt: sample.prompt,
    summary: sample.summary,
    category: sample.category,
    tags: sample.tags,
    model: sample.model,
    aspect: parseAspect(sample.aspect),
    previewImageUrl: sample.previewImageUrl,
    previewVideoUrl: sample.previewVideoUrl,
    source: sample.source,
    cfgScale: sample.cfgScale,
    durationSec: sample.durationSec,
    fps: sample.fps,
    negativePrompt: sample.negativePrompt,
    parameters: sample.parameters,
    sampler: sample.sampler,
    seed: sample.seed,
    steps: sample.steps,
    _meta: {
      accountId: meta.accountId,
      label: meta.label ?? 'production',
      locales: meta.locales ?? [],
      repoSlug,
      repoVisibility: meta.repoVisibility ?? 'platform',
      sampleId: meta.sampleId ?? sample.id,
      sampleSlug: sample.id,
      version: meta.version ?? '',
    },
  };
}

function builtInTemplateToSample(
  template: PromptTemplateSnapshot,
): PromptLibrarySample {
  return {
    ...template,
    prompt: template.prompt ?? '',
    _meta: {
      label: 'built-in',
      locales: [],
      repoSlug: 'built-in',
      repoVisibility: 'platform',
      sampleId: template.id,
      sampleSlug: template.id,
      version: 'built-in',
    },
  };
}

function normalizeFilters(filters: PromptLibraryFilters) {
  const rawLimit = filters.limit;
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? rawLimit
      : DEFAULT_LIMIT;

  return {
    ...filters,
    limit: Math.min(Math.max(Math.trunc(limit), 1), 100),
    surface: filters.surface ?? 'image',
  };
}

function parseAspect(value: string | undefined) {
  return PROMPT_ASPECTS.has(
    value as NonNullable<PromptTemplateSnapshot['aspect']>,
  )
    ? (value as NonNullable<PromptTemplateSnapshot['aspect']>)
    : undefined;
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
