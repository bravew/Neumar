import { describe, expect, it } from 'vitest';

import {
  CLAUDE_FALLBACK_MODEL,
  CLAUDE_FABLE_5_UPGRADE_MESSAGE,
  CLAUDE_OPUS_5_UPGRADE_MESSAGE,
  CLAUDE_SONNET_5_UPGRADE_MESSAGE,
  DEFAULT_CLAUDE_MODEL,
  MIN_CLAUDE_CODE_FABLE_5_VERSION,
  MIN_CLAUDE_CODE_OPUS_5_VERSION,
  MIN_CLAUDE_CODE_SONNET_5_VERSION,
  getClaudeCodeModelSupportError,
  isClaudeFable5,
  isClaudeOpus5,
  isClaudeSonnet5,
  isVersionAtLeast,
  normalizeClaudeRuntimeError,
  normalizeClaudeThinkingForSdk,
  requiresClaudeCodeSonnet5Minimum,
} from '@/core/agent/claude-models';

describe('Claude model helpers', () => {
  it('recognizes Sonnet 5 IDs and aliases', () => {
    expect(isClaudeSonnet5(DEFAULT_CLAUDE_MODEL)).toBe(true);
    expect(isClaudeSonnet5('anthropic/claude-sonnet-5')).toBe(true);
    expect(isClaudeSonnet5('sonnet')).toBe(true);
    expect(isClaudeSonnet5('sonnet[1m]')).toBe(true);
    expect(isClaudeSonnet5('claude-sonnet-4-6')).toBe(false);
  });

  it('recognizes Opus 5 and Fable 5 model ids', () => {
    expect(isClaudeOpus5('claude-opus-5')).toBe(true);
    expect(isClaudeOpus5('anthropic/claude-opus-5')).toBe(true);
    expect(isClaudeOpus5('opus')).toBe(true);
    expect(isClaudeOpus5('claude-opus-4-8')).toBe(false);
    expect(isClaudeFable5('claude-fable-5')).toBe(true);
  });

  it('applies the model-specific Claude Code version gates', () => {
    expect(getClaudeCodeModelSupportError('claude-opus-5', '2.1.218')).toBe(
      CLAUDE_OPUS_5_UPGRADE_MESSAGE,
    );
    expect(
      getClaudeCodeModelSupportError(
        'claude-opus-5',
        MIN_CLAUDE_CODE_OPUS_5_VERSION,
      ),
    ).toBeNull();
    // The alias is version-dependent, so it must not silently select 4.8.
    expect(getClaudeCodeModelSupportError('opus', '2.1.218')).toBe(
      CLAUDE_OPUS_5_UPGRADE_MESSAGE,
    );
    expect(getClaudeCodeModelSupportError('claude-fable-5', '2.1.169')).toBe(
      CLAUDE_FABLE_5_UPGRADE_MESSAGE,
    );
    expect(
      getClaudeCodeModelSupportError(
        'claude-fable-5',
        MIN_CLAUDE_CODE_FABLE_5_VERSION,
      ),
    ).toBeNull();
  });

  it('falls back to Sonnet 4.6 only when the CLI is too old for Sonnet 5', () => {
    // Mirrors the resolveSupportedClaudeModel decision: downgrade Sonnet 5 to
    // CLAUDE_FALLBACK_MODEL when the installed Claude Code predates the floor,
    // and leave supported models (or the fallback itself) untouched.
    const needsFallback = (model: string, version: string) =>
      requiresClaudeCodeSonnet5Minimum(model) &&
      !isVersionAtLeast(version, MIN_CLAUDE_CODE_SONNET_5_VERSION);

    expect(CLAUDE_FALLBACK_MODEL).toBe('claude-sonnet-4-6');
    expect(needsFallback('claude-sonnet-5', '2.1.100')).toBe(true);
    expect(
      needsFallback('claude-sonnet-5', MIN_CLAUDE_CODE_SONNET_5_VERSION),
    ).toBe(false);
    // The fallback target never itself needs the Sonnet 5 minimum.
    expect(requiresClaudeCodeSonnet5Minimum(CLAUDE_FALLBACK_MODEL)).toBe(false);
  });

  it('compares Claude Code versions against the Sonnet 5 floor', () => {
    expect(isVersionAtLeast('2.1.197', MIN_CLAUDE_CODE_SONNET_5_VERSION)).toBe(
      true,
    );
    expect(isVersionAtLeast('2.2.0', MIN_CLAUDE_CODE_SONNET_5_VERSION)).toBe(
      true,
    );
    expect(isVersionAtLeast('2.1.196', MIN_CLAUDE_CODE_SONNET_5_VERSION)).toBe(
      false,
    );
  });

  it('normalizes fixed-budget thinking to adaptive for Sonnet 5', () => {
    expect(
      normalizeClaudeThinkingForSdk('claude-sonnet-5', {
        type: 'enabled',
        budgetTokens: 10_000,
      }),
    ).toEqual({ thinking: { type: 'adaptive' } });
    expect(
      JSON.stringify(
        normalizeClaudeThinkingForSdk('claude-sonnet-5', {
          type: 'enabled',
          budgetTokens: 10_000,
        }),
      ),
    ).not.toContain('budgetTokens');
  });

  it('preserves fixed-budget thinking for older Claude models', () => {
    expect(
      normalizeClaudeThinkingForSdk('claude-sonnet-4-6', {
        type: 'enabled',
        budgetTokens: 10_000,
      }),
    ).toEqual({
      thinking: { type: 'enabled', budgetTokens: 10_000 },
    });
  });

  it('surfaces a Sonnet 5-specific upgrade message for unsupported-model errors', () => {
    expect(
      normalizeClaudeRuntimeError(
        'unsupported model: claude-sonnet-5',
        'claude-sonnet-5',
      ),
    ).toBe(CLAUDE_SONNET_5_UPGRADE_MESSAGE);
    expect(
      normalizeClaudeRuntimeError('unsupported model', 'claude-opus-4-8'),
    ).toBe('unsupported model');
  });

  it('normalizes unresolved Sonnet 5 startup errors from the message text', () => {
    expect(
      normalizeClaudeRuntimeError(
        'invalid model: claude-sonnet-5 requires Claude Code 2.1.197',
        undefined,
      ),
    ).toBe(CLAUDE_SONNET_5_UPGRADE_MESSAGE);
  });
});
