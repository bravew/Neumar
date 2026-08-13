/**
 * Curated Claude/Codex model catalogs for the chat model picker.
 *
 * Deliberately dependency-free (no `@/` imports) so it can be read directly
 * — via a relative import — from the `src-api` workspace's parity test
 * (`test/unit/agent-runtimes/model-catalog-parity.test.ts`), which checks
 * this list against the agent-runtime registry's `fallbackModels` so the two
 * cannot silently drift apart again.
 */

import type { AIProvider } from '@/shared/db/settings';

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  descKey?: string; // locale key — resolved to description at render time
  provider: NonNullable<AIProvider['agentType']>;
  /** Shown but not selectable (runtime installed yet blocked: needs sign-in,
   *  or lacks this mode's capability). Reason rendered in the row. */
  disabled?: boolean;
  disabledReason?: string;
  source?: 'fallback' | 'discovered' | 'configured';
  availability?: 'available' | 'unavailable' | 'unknown';
  unavailableReason?: string;
  contextWindowTokens?: number;
  capabilityTags?: string[];
  costTier?: 'low' | 'medium' | 'high';
  speedTier?: 'low' | 'medium' | 'high';
  compatibleReasoningTiers?: string[];
  compatibleServiceTiers?: string[];
}

export const DEFAULT_MODEL_ID = 'claude-sonnet-5';

export const CLAUDE_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    description: '',
    descKey: 'modelDescBalanced',
    provider: 'claude',
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    description: '',
    descKey: 'modelDescMostCapable',
    provider: 'claude',
  },
  {
    id: 'claude-fable-5',
    label: 'Fable 5',
    description: '',
    provider: 'claude',
  },
  {
    id: 'claude-opus-4-8',
    label: 'Opus 4.8',
    description: '',
    provider: 'claude',
  },
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7',
    description: '',
    provider: 'claude',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.6',
    description: '',
    provider: 'claude',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    description: '',
    provider: 'claude',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    description: '',
    descKey: 'modelDescFastLightweight',
    provider: 'claude',
  },
];

/** Codex CLI model variants — always available, no API key needed in settings.
 *  Model IDs use the `codex:<model>` prefix so the backend can extract the
 *  underlying model name (e.g. `codex:o3` → Codex CLI running with o3). */
export const CODEX_MODELS: ModelOption[] = [
  {
    id: 'codex:gpt-5.5',
    label: 'gpt-5.5',
    description: '',
    descKey: 'modelDescCodexLatestFrontier',
    provider: 'codex',
  },
  {
    id: 'codex:gpt-5.4',
    label: 'gpt-5.4',
    description: '',
    descKey: 'modelDescCodexPriorFrontier',
    provider: 'codex',
  },
  {
    id: 'codex:gpt-5.4-mini',
    label: 'gpt-5.4 mini',
    description: '',
    descKey: 'modelDescCodexFrontierMini',
    provider: 'codex',
  },
  {
    id: 'codex:gpt-5.3-codex',
    label: 'gpt-5.3-codex',
    description: '',
    descKey: 'modelDescCodexLatestFrontierCoding',
    provider: 'codex',
  },
  {
    id: 'codex:gpt-5.1-codex-mini',
    label: 'gpt-5.1-codex mini',
    description: '',
    descKey: 'modelDescCodexSpark',
    provider: 'codex',
  },
  {
    id: 'codex:gpt-5-codex',
    label: 'gpt-5-codex',
    description: '',
    descKey: 'modelDescCodexFrontierCoding',
    provider: 'codex',
  },
  {
    id: 'codex:gpt-5',
    label: 'gpt-5',
    description: '',
    descKey: 'modelDescCodexFlagshipReasoning',
    provider: 'codex',
  },
  {
    id: 'codex:o3',
    label: 'o3',
    description: '',
    provider: 'codex',
  },
  {
    id: 'codex:o4-mini',
    label: 'o4-mini',
    description: '',
    descKey: 'modelDescOptimizedMini',
    provider: 'codex',
  },
];
