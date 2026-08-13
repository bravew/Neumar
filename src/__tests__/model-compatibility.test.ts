import { describe, expect, it } from 'vitest';

import {
  CLAUDE_EFFORT_LEVELS,
  compatibleThinkingTypes,
  DEFAULT_CLAUDE_EFFORT,
  normalizeThinkingForModel,
  validateModelConfiguration,
} from '@/components/shared/model-compatibility';

describe('model compatibility preflight', () => {
  it('exposes the Claude effort ladder with high as the default', () => {
    expect(CLAUDE_EFFORT_LEVELS).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(DEFAULT_CLAUDE_EFFORT).toBe('high');
  });

  it.each([
    'claude-opus-5',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-sonnet-5',
  ])('rejects sampling and fixed budgets for %s', (modelId) => {
    expect(validateModelConfiguration({ modelId, usesSampling: true })).toBe(
      'sampling_not_supported',
    );
    expect(
      validateModelConfiguration({ modelId, usesBudgetTokens: true }),
    ).toBe('budget_tokens_not_supported');
  });

  it('rejects thinking off with xhigh or max effort on Opus 5', () => {
    expect(
      validateModelConfiguration({
        modelId: 'claude-opus-5',
        thinking: 'disabled',
        effort: 'xhigh',
      }),
    ).toBe('thinking_off_incompatible_with_effort');
    expect(
      validateModelConfiguration({
        modelId: 'claude-opus-5',
        thinking: 'disabled',
        effort: 'high',
      }),
    ).toBeNull();
  });

  it('removes legacy thinking budgets and defaults adaptive effort to high', () => {
    expect(compatibleThinkingTypes('claude-opus-5')).toEqual([
      'adaptive',
      'disabled',
    ]);
    expect(compatibleThinkingTypes('claude-sonnet-4-6')).toContain('enabled');
    expect(
      normalizeThinkingForModel('claude-fable-5', {
        type: 'enabled',
        budgetTokens: 10_000,
      }),
    ).toEqual({ type: 'adaptive', effort: 'high' });
    expect(
      normalizeThinkingForModel('claude-opus-5', { type: 'adaptive' }),
    ).toEqual({ type: 'adaptive', effort: 'high' });
  });
});
