import type { AgentOptions } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
export const MIN_CLAUDE_CODE_SONNET_5_VERSION = '2.1.197';
export const MIN_CLAUDE_CODE_OPUS_5_VERSION = '2.1.219';
export const MIN_CLAUDE_CODE_FABLE_5_VERSION = '2.1.170';

/**
 * Model to fall back to when the selected one (e.g. Sonnet 5) can't run on the
 * user's setup — a widely-available previous Sonnet so users without the latest
 * model/CLI keep working instead of hitting a hard error.
 */
export const CLAUDE_FALLBACK_MODEL = 'claude-sonnet-4-6';

export const CLAUDE_SONNET_5_UPGRADE_MESSAGE =
  'Claude Sonnet 5 requires Claude Code v2.1.197 or newer. Run `claude update` or `npm install -g @anthropic-ai/claude-code@latest`, then try again.';
export const CLAUDE_OPUS_5_UPGRADE_MESSAGE =
  'Claude Opus 5 requires Claude Code v2.1.219 or newer. Run `claude update` or `npm install -g @anthropic-ai/claude-code@latest`, then try again.';
export const CLAUDE_FABLE_5_UPGRADE_MESSAGE =
  'Claude Fable 5 requires Claude Code v2.1.170 or newer. Run `claude update` or `npm install -g @anthropic-ai/claude-code@latest`, then try again.';

type ThinkingConfig = AgentOptions['thinkingConfig'];

function modelLeaf(model: string): string {
  const trimmed = model.trim().toLowerCase();
  return trimmed.split('/').pop() ?? trimmed;
}

export function isClaudeSonnet5(model: string | null | undefined): boolean {
  if (!model) return false;
  const leaf = modelLeaf(model);
  return (
    leaf === DEFAULT_CLAUDE_MODEL || leaf === 'sonnet' || leaf === 'sonnet[1m]'
  );
}

export function isClaudeOpus5(model: string | null | undefined): boolean {
  if (!model) return false;
  const leaf = modelLeaf(model);
  return leaf === 'claude-opus-5' || leaf === 'opus' || leaf === 'opus[1m]';
}

export function isClaudeFable5(model: string | null | undefined): boolean {
  if (!model) return false;
  return modelLeaf(model) === 'claude-fable-5';
}

export function isVersionAtLeast(
  version: string | undefined,
  minimum: string,
): boolean {
  if (!version) return false;
  const parse = (value: string) =>
    value
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const actual = parse(version);
  const required = parse(minimum);
  for (let i = 0; i < Math.max(actual.length, required.length); i += 1) {
    const a = actual[i] ?? 0;
    const b = required[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

export function requiresClaudeCodeSonnet5Minimum(
  model: string | null | undefined,
): boolean {
  return isClaudeSonnet5(model);
}

export interface ClaudeCodeModelRequirement {
  minimumVersion: string;
  upgradeMessage: string;
}

export function getClaudeCodeModelRequirement(
  model: string | null | undefined,
): ClaudeCodeModelRequirement | null {
  if (isClaudeOpus5(model)) {
    return {
      minimumVersion: MIN_CLAUDE_CODE_OPUS_5_VERSION,
      upgradeMessage: CLAUDE_OPUS_5_UPGRADE_MESSAGE,
    };
  }
  if (isClaudeSonnet5(model)) {
    return {
      minimumVersion: MIN_CLAUDE_CODE_SONNET_5_VERSION,
      upgradeMessage: CLAUDE_SONNET_5_UPGRADE_MESSAGE,
    };
  }
  if (isClaudeFable5(model)) {
    return {
      minimumVersion: MIN_CLAUDE_CODE_FABLE_5_VERSION,
      upgradeMessage: CLAUDE_FABLE_5_UPGRADE_MESSAGE,
    };
  }
  return null;
}

export function getClaudeCodeModelSupportError(
  model: string | null | undefined,
  version: string | undefined,
): string | null {
  const requirement = getClaudeCodeModelRequirement(model);
  if (!requirement || isVersionAtLeast(version, requirement.minimumVersion)) {
    return null;
  }
  return requirement.upgradeMessage;
}

export function normalizeClaudeThinkingForSdk(
  model: string | null | undefined,
  thinkingConfig: ThinkingConfig,
): Record<string, unknown> {
  if (!thinkingConfig) return {};

  const result: Record<string, unknown> = {};
  if (isClaudeSonnet5(model)) {
    if (thinkingConfig.type === 'disabled') {
      result.thinking = { type: 'disabled' };
      return result;
    }
    result.thinking = { type: 'adaptive' };
    if (thinkingConfig.effort) result.effort = thinkingConfig.effort;
    return result;
  }

  if (thinkingConfig.type === 'adaptive') {
    result.thinking = { type: 'adaptive' };
    if (thinkingConfig.effort) result.effort = thinkingConfig.effort;
  } else if (thinkingConfig.type === 'enabled') {
    result.thinking = {
      type: 'enabled',
      budgetTokens: thinkingConfig.budgetTokens ?? 10_000,
    };
  } else if (thinkingConfig.type === 'disabled') {
    result.thinking = { type: 'disabled' };
  }
  return result;
}

export function normalizeClaudeRuntimeError(
  message: string,
  model: string | null | undefined,
): string {
  const normalizedRequirement = getClaudeCodeModelRequirement(model);
  if (
    normalizedRequirement &&
    /unsupported model|unknown model|invalid model|not a recognized model id/i.test(
      message,
    )
  ) {
    return normalizedRequirement.upgradeMessage;
  }
  if (/opus 5|claude-opus-5|2\.1\.219/i.test(message)) {
    return CLAUDE_OPUS_5_UPGRADE_MESSAGE;
  }
  if (/fable 5|claude-fable-5|2\.1\.170/i.test(message)) {
    return CLAUDE_FABLE_5_UPGRADE_MESSAGE;
  }
  const mentionsSonnet5 = /sonnet 5|claude-sonnet-5|2\.1\.197/i.test(message);
  if (!isClaudeSonnet5(model) && !mentionsSonnet5) return message;
  if (
    /unsupported model|unknown model|invalid model|sonnet 5|claude-sonnet-5|2\.1\.197/i.test(
      message,
    )
  ) {
    return CLAUDE_SONNET_5_UPGRADE_MESSAGE;
  }
  return message;
}
