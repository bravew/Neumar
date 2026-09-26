import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import {
  getAgentDef,
  parseClaudeSupportedModels,
  parseCodexModelCatalog,
} from '@/shared/agent-runtimes';

// Real `supportedModels()` shape (Claude Code 2.1.280, SDK 0.3.239), trimmed.
const CLAUDE_SUPPORTED_MODELS: ModelInfo[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Default (recommended)',
    description: 'Opus 5.5 · Best for everyday, complex tasks',
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus',
    description:
      'Opus 5.5 · Best for everyday, complex tasks · ~2× usage vs Sonnet',
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'claude-fable-5-1[1m]',
    resolvedModel: 'claude-fable-5-1',
    displayName: 'Fable',
    description:
      'Fable 5.1 · Most capable for your hardest and longest-running tasks · Requires usage credits',
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks',
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers',
  },
];

// Real `codex debug models` shape (codex-cli 0.157.0), trimmed.
const CODEX_CATALOG = JSON.stringify({
  models: [
    {
      slug: 'gpt-5.5',
      display_name: 'GPT-5.5',
      description:
        'Proven previous-generation model for coding and general work.',
      visibility: 'list',
      priority: 12,
      context_window: 272000,
      input_modalities: ['text', 'image'],
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
      ],
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Codex Auto Review',
      visibility: 'hide',
      priority: 43,
    },
    {
      slug: 'gpt-6-astra',
      display_name: 'GPT-6-Astra',
      description: 'Our most capable model for complex, demanding work.',
      visibility: 'list',
      priority: 1,
      context_window: 272000,
      input_modalities: ['text', 'image'],
    },
    {
      slug: 'glm-5.3:cloud',
      display_name: 'glm-5.3:cloud',
      description: 'Ollama model',
      visibility: 'list',
      priority: -3,
      input_modalities: ['text'],
    },
  ],
});

describe('parseClaudeSupportedModels', () => {
  it('lists the models the CLI reports, keyed by canonical ids', () => {
    const models = parseClaudeSupportedModels(CLAUDE_SUPPORTED_MODELS);
    expect(models?.map((m) => m.id)).toEqual([
      'default',
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
    ]);
  });

  it('labels rows with the concrete version and keeps the summary', () => {
    const models = parseClaudeSupportedModels(CLAUDE_SUPPORTED_MODELS)!;
    expect(models.find((m) => m.id === 'claude-opus-5-5')).toEqual({
      id: 'claude-opus-5-5',
      label: 'Opus 5.5',
      description: 'Best for everyday, complex tasks · ~2× usage vs Sonnet',
      compatibleReasoningTiers: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    // CLI-only `[1m]` spelling is replaced by the API-valid resolved id.
    expect(models.find((m) => m.id === 'claude-fable-5-1')).toMatchObject({
      label: 'Fable 5.1',
    });
  });

  it('returns null when the CLI reports nothing selectable', () => {
    expect(parseClaudeSupportedModels([])).toBeNull();
    expect(
      parseClaudeSupportedModels([CLAUDE_SUPPORTED_MODELS[0]!]),
    ).toBeNull();
  });
});

describe('parseCodexModelCatalog', () => {
  it('keeps listed models in CLI priority order and drops hidden ones', () => {
    const models = parseCodexModelCatalog(CODEX_CATALOG);
    expect(models?.map((m) => m.id)).toEqual([
      'default',
      'glm-5.3:cloud',
      'gpt-6-astra',
      'gpt-5.5',
    ]);
  });

  it('maps labels, context window, vision, and reasoning levels', () => {
    const gpt55 = parseCodexModelCatalog(CODEX_CATALOG)!.find(
      (m) => m.id === 'gpt-5.5',
    );
    expect(gpt55).toEqual({
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      description:
        'Proven previous-generation model for coding and general work.',
      contextWindowTokens: 272000,
      capabilityTags: ['chat', 'vision'],
      compatibleReasoningTiers: ['low', 'medium', 'high', 'xhigh'],
    });
  });

  it('returns null for non-catalog output so detection falls back', () => {
    expect(parseCodexModelCatalog('error: unrecognized subcommand')).toBeNull();
    expect(parseCodexModelCatalog('{"models":[]}')).toBeNull();
    expect(parseCodexModelCatalog('null')).toBeNull();
  });
});

describe('runtime defs discover live models', () => {
  it('probes Claude through the SDK and Codex through its catalog', () => {
    expect(typeof getAgentDef('claude')?.fetchModels).toBe('function');
    expect(getAgentDef('codex')?.listModels?.args).toEqual(['debug', 'models']);
  });
});
