export const CLAUDE_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ClaudeEffortLevel = (typeof CLAUDE_EFFORT_LEVELS)[number];
export const DEFAULT_CLAUDE_EFFORT: ClaudeEffortLevel = 'high';

export interface ModelConfiguration {
  modelId: string;
  effort?: ClaudeEffortLevel;
  thinking?: 'adaptive' | 'disabled';
  usesSampling?: boolean;
  usesBudgetTokens?: boolean;
}

export type ModelCompatibilityFailure =
  | 'sampling_not_supported'
  | 'budget_tokens_not_supported'
  | 'thinking_off_incompatible_with_effort';

function modelLeaf(modelId: string): string {
  return modelId.toLowerCase().split('/').pop() ?? modelId.toLowerCase();
}

export function usesAdaptiveThinkingOnly(modelId: string): boolean {
  const model = modelLeaf(modelId);
  return (
    model === 'claude-opus-5' ||
    model === 'claude-opus-4-7' ||
    model === 'claude-opus-4-8' ||
    model === 'claude-fable-5' ||
    model === 'claude-sonnet-5'
  );
}

export type CompatibleThinkingType = 'adaptive' | 'enabled' | 'disabled';

export function compatibleThinkingTypes(
  modelId: string,
): readonly CompatibleThinkingType[] {
  return usesAdaptiveThinkingOnly(modelId)
    ? ['adaptive', 'disabled']
    : ['adaptive', 'enabled', 'disabled'];
}

export function normalizeThinkingForModel<
  T extends {
    type: CompatibleThinkingType;
    effort?: ClaudeEffortLevel;
    budgetTokens?: number;
  },
>(modelId: string, config: T | null): T | null {
  if (!config) return null;
  if (usesAdaptiveThinkingOnly(modelId) && config.type === 'enabled') {
    return {
      type: 'adaptive',
      effort: DEFAULT_CLAUDE_EFFORT,
    } as T;
  }
  if (config.type === 'adaptive' && !config.effort) {
    return { ...config, effort: DEFAULT_CLAUDE_EFFORT };
  }
  return config;
}

export function validateModelConfiguration(
  config: ModelConfiguration,
): ModelCompatibilityFailure | null {
  if (usesAdaptiveThinkingOnly(config.modelId)) {
    if (config.usesSampling) return 'sampling_not_supported';
    if (config.usesBudgetTokens) return 'budget_tokens_not_supported';
  }
  if (
    modelLeaf(config.modelId) === 'claude-opus-5' &&
    config.thinking === 'disabled' &&
    (config.effort === 'xhigh' || config.effort === 'max')
  ) {
    return 'thinking_off_incompatible_with_effort';
  }
  return null;
}
