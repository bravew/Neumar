/**
 * Memory Configuration — reads from the settings table.
 *
 * Uses the same getSetting/saveSetting pattern as the rest of the codebase.
 * Memory config keys are stored under the `memory.*` namespace.
 */

import { getSetting, saveSetting } from '@/shared/db/operations';

import type {
  CaptureGuardLevel,
  ConsolidationConfig,
  DecayConfig,
  MemoryConfig,
} from './types';
import {
  DEFAULT_CONSOLIDATION_CONFIG,
  DEFAULT_DECAY_CONFIG,
  DEFAULT_MEMORY_CONFIG,
} from './types';

/** Create a typed settings reader for a given key prefix. */
function makeSettingsReader(prefix: string) {
  return <T>(key: string, fallback: T): T => {
    const raw = getSetting(`${prefix}${key}`);
    if (raw === null) return fallback;
    if (typeof fallback === 'boolean') return (raw === 'true') as T;
    if (typeof fallback === 'number') return Number(raw) as T;
    return raw as T;
  };
}

/** Read the full memory config from the settings table. */
export function getMemoryConfig(): MemoryConfig {
  const get = makeSettingsReader('memory.');

  return {
    enabled: get('enabled', DEFAULT_MEMORY_CONFIG.enabled),
    autoCapture: get('autoCapture', DEFAULT_MEMORY_CONFIG.autoCapture),
    autoRecall: get('autoRecall', DEFAULT_MEMORY_CONFIG.autoRecall),
    embeddingProvider: get(
      'embeddingProvider',
      DEFAULT_MEMORY_CONFIG.embeddingProvider,
    ) as MemoryConfig['embeddingProvider'],
    embeddingApiKey: get(
      'embeddingApiKey',
      DEFAULT_MEMORY_CONFIG.embeddingApiKey,
    ),
    embeddingModel: get('embeddingModel', DEFAULT_MEMORY_CONFIG.embeddingModel),
    maxMemories: get('maxMemories', DEFAULT_MEMORY_CONFIG.maxMemories),
    captureMaxChars: get(
      'captureMaxChars',
      DEFAULT_MEMORY_CONFIG.captureMaxChars,
    ),
    recallLimit: get('recallLimit', DEFAULT_MEMORY_CONFIG.recallLimit),
    recallThreshold: get(
      'recallThreshold',
      DEFAULT_MEMORY_CONFIG.recallThreshold,
    ),
    embeddingDim: get('embeddingDim', DEFAULT_MEMORY_CONFIG.embeddingDim),
    llmCapture: get('llmCapture', DEFAULT_MEMORY_CONFIG.llmCapture),
    llmCaptureInterval: get(
      'llmCaptureInterval',
      DEFAULT_MEMORY_CONFIG.llmCaptureInterval,
    ),
    sessionIndexing: get(
      'sessionIndexing',
      DEFAULT_MEMORY_CONFIG.sessionIndexing,
    ),
    decayEnabled: get('decayEnabled', DEFAULT_MEMORY_CONFIG.decayEnabled),
    consolidationEnabled: get(
      'consolidationEnabled',
      DEFAULT_MEMORY_CONFIG.consolidationEnabled,
    ),
    entityExtractionEnabled: get(
      'entityExtractionEnabled',
      DEFAULT_MEMORY_CONFIG.entityExtractionEnabled,
    ),
    captureGuardLevel: get(
      'captureGuardLevel',
      DEFAULT_MEMORY_CONFIG.captureGuardLevel,
    ) as CaptureGuardLevel,
    // v3 (memdir-inspired)
    llmRerankEnabled: get(
      'llmRerankEnabled',
      DEFAULT_MEMORY_CONFIG.llmRerankEnabled,
    ),
    llmRerankModel: get('llmRerankModel', DEFAULT_MEMORY_CONFIG.llmRerankModel),
    maxRecallTokens: get(
      'maxRecallTokens',
      DEFAULT_MEMORY_CONFIG.maxRecallTokens,
    ),
    journalMode: get('journalMode', DEFAULT_MEMORY_CONFIG.journalMode),
  };
}

/** Save a partial memory config update to the settings table. */
export function saveMemoryConfig(updates: Partial<MemoryConfig>): void {
  for (const [key, value] of Object.entries(updates)) {
    saveSetting(`memory.${key}`, String(value));
  }
}

/** Build EmbedOptions from the current memory config. */
export function getEmbedOptions(config: MemoryConfig) {
  return {
    provider: config.embeddingProvider,
    apiKey: config.embeddingApiKey || undefined,
    model: config.embeddingModel || undefined,
  };
}

/** Read decay configuration from the settings table. */
export function getDecayConfig(): DecayConfig {
  const get = makeSettingsReader('memory.decay.');

  return {
    enabled: get('enabled', DEFAULT_DECAY_CONFIG.enabled),
    episodicHalfLife: get(
      'episodicHalfLife',
      DEFAULT_DECAY_CONFIG.episodicHalfLife,
    ),
    semanticHalfLife: get(
      'semanticHalfLife',
      DEFAULT_DECAY_CONFIG.semanticHalfLife,
    ),
    proceduralHalfLife: get(
      'proceduralHalfLife',
      DEFAULT_DECAY_CONFIG.proceduralHalfLife,
    ),
    pruneThreshold: get('pruneThreshold', DEFAULT_DECAY_CONFIG.pruneThreshold),
    accessResetFactor: get(
      'accessResetFactor',
      DEFAULT_DECAY_CONFIG.accessResetFactor,
    ),
  };
}

/** Read consolidation configuration from the settings table. */
export function getConsolidationConfig(): ConsolidationConfig {
  const get = makeSettingsReader('memory.consolidation.');

  return {
    enabled: get('enabled', DEFAULT_CONSOLIDATION_CONFIG.enabled),
    intervalDays: get(
      'intervalDays',
      DEFAULT_CONSOLIDATION_CONFIG.intervalDays,
    ),
    minMemoriesForRun: get(
      'minMemoriesForRun',
      DEFAULT_CONSOLIDATION_CONFIG.minMemoriesForRun,
    ),
    maxMergePerRun: get(
      'maxMergePerRun',
      DEFAULT_CONSOLIDATION_CONFIG.maxMergePerRun,
    ),
    similarityThreshold: get(
      'similarityThreshold',
      DEFAULT_CONSOLIDATION_CONFIG.similarityThreshold,
    ),
  };
}
