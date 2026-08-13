import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OUTPUT_TOKEN_BUDGET,
  clampDefaultOutputTokens,
  estimateOutputBudgetInputTokens,
  inferContextWindowTokens,
} from '@/core/agent/output-budget';

describe('clampDefaultOutputTokens', () => {
  it('preserves explicit caller budgets', () => {
    expect(
      clampDefaultOutputTokens(
        { id: 'claude-sonnet-4-6', contextWindowTokens: 200_000 },
        {
          explicitMaxTokens: 180_000,
          defaultMaxTokens: 199_000,
          inputTokens: 190_000,
        },
      ),
    ).toBe(180_000);
  });

  it('caps near-window defaults to the shared output budget', () => {
    expect(
      clampDefaultOutputTokens(
        { id: 'claude-sonnet-4-6', contextWindowTokens: 200_000 },
        { defaultMaxTokens: 199_000 },
      ),
    ).toBe(DEFAULT_OUTPUT_TOKEN_BUDGET);
  });

  it('keeps long-context requests inside available response headroom', () => {
    expect(
      clampDefaultOutputTokens(
        { id: 'claude-sonnet-4-6', contextWindowTokens: 200_000 },
        { defaultMaxTokens: 64_000, inputTokens: 180_000 },
      ),
    ).toBe(18_976);
  });

  it('reserves visible output when thinking is enabled', () => {
    expect(
      clampDefaultOutputTokens(
        { id: 'claude-sonnet-4-6', contextWindowTokens: 200_000 },
        {
          defaultMaxTokens: 4_096,
          thinkingEnabled: true,
          thinkingBudgetTokens: 10_000,
        },
      ),
    ).toBe(11_024);
  });

  it('estimates prompt tokens conservatively', () => {
    expect(estimateOutputBudgetInputTokens('12345678')).toBe(2);
  });

  it('infers Sonnet 5 as a long-context model', () => {
    expect(inferContextWindowTokens('claude-sonnet-5')).toBe(1_000_000);
    expect(inferContextWindowTokens('anthropic/claude-sonnet-5')).toBe(
      1_000_000,
    );
  });

  it('keeps the current Claude long-context catalog aligned', () => {
    for (const model of [
      'claude-opus-5',
      'claude-fable-5',
      'claude-sonnet-4-6',
    ]) {
      expect(inferContextWindowTokens(model)).toBe(1_000_000);
    }
  });
});
