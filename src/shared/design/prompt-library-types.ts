import type { PromptTemplateSnapshot } from '@/shared/types/design-mode';

export type PromptLibrarySurface = PromptTemplateSnapshot['surface'];

export interface PromptLibraryFilters {
  category?: string;
  locale?: string;
  limit?: number;
  model?: string;
  q?: string;
  surface?: PromptLibrarySurface;
  tag?: string;
}

export interface PromptLibrarySample extends PromptTemplateSnapshot {
  cfgScale?: string;
  durationSec?: string;
  fps?: number;
  negativePrompt?: string;
  parameters?: Record<string, unknown>;
  sampler?: string;
  seed?: string;
  steps?: number;
  _meta: {
    accountId?: string;
    label: string;
    locales: string[];
    repoSlug: string;
    repoVisibility: 'platform' | 'team';
    sampleId: string;
    sampleSlug: string;
    version: string;
  };
}

export interface PromptLibraryResult {
  generatedAt?: string;
  items: PromptLibrarySample[];
  nextCursor?: string;
  offline: boolean;
}
