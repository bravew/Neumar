const CHARS_PER_TOKEN_ESTIMATE = 4;

export const DEFAULT_OUTPUT_TOKEN_BUDGET = 32_768;
export const RESPONSE_HEADROOM_TOKENS = 1_024;
export const MIN_VISIBLE_OUTPUT_TOKENS = 1_024;

export interface OutputBudgetModel {
  id: string;
  contextWindowTokens?: number;
}

export interface OutputBudgetRequest {
  /**
   * Explicit user or caller override. Explicit values are returned unchanged
   * because this helper only clamps defaults.
   */
  explicitMaxTokens?: number;
  /** Provider default or existing code default. */
  defaultMaxTokens?: number;
  /** Estimated tokens already consumed by prompt/messages/system context. */
  inputTokens?: number;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
}

export function estimateOutputBudgetInputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function inferContextWindowTokens(modelId: string): number | undefined {
  const id = modelId.toLowerCase();

  if (id.includes('gemini-2.5')) return 1_000_000;
  if (id.includes('gpt-4.1') || id.includes('gpt-5')) return 1_000_000;
  if (id.includes('gpt-4o') || id.startsWith('o1') || id.startsWith('o3')) {
    return 128_000;
  }
  if (
    id.includes('claude-opus-5') ||
    id.includes('claude-fable-5') ||
    id.includes('claude-sonnet-4-6') ||
    id.includes('claude-sonnet-5') ||
    id.includes('claude-opus-4-6') ||
    id.includes('claude-opus-4-7') ||
    id.includes('claude-opus-4-8')
  ) {
    return 1_000_000;
  }
  if (id.includes('claude')) return 200_000;
  if (id.includes('deepseek') || id.startsWith('seed-')) return 128_000;

  return undefined;
}

/**
 * Clamp default output-token budgets so long-context calls keep response
 * headroom. Explicit caller/user budgets are intentionally not clamped.
 */
export function clampDefaultOutputTokens(
  model: OutputBudgetModel,
  request: OutputBudgetRequest,
): number | undefined {
  if (request.explicitMaxTokens !== undefined) {
    return sanitizeTokenBudget(request.explicitMaxTokens);
  }

  const contextWindow =
    model.contextWindowTokens ?? inferContextWindowTokens(model.id);
  if (!contextWindow && request.defaultMaxTokens === undefined) {
    return undefined;
  }

  const inputTokens = Math.max(0, request.inputTokens ?? 0);
  const defaultMaxTokens = sanitizeTokenBudget(
    request.defaultMaxTokens ??
      Math.max(
        MIN_VISIBLE_OUTPUT_TOKENS,
        contextWindow! - RESPONSE_HEADROOM_TOKENS,
      ),
  );

  if (!contextWindow) return defaultMaxTokens;

  const maxAvailable = Math.max(
    MIN_VISIBLE_OUTPUT_TOKENS,
    contextWindow - inputTokens - RESPONSE_HEADROOM_TOKENS,
  );

  const nearContextWindow =
    defaultMaxTokens >= contextWindow - RESPONSE_HEADROOM_TOKENS;
  const overAvailableWindow = defaultMaxTokens > maxAvailable;

  let next =
    nearContextWindow || overAvailableWindow
      ? Math.min(DEFAULT_OUTPUT_TOKEN_BUDGET, maxAvailable)
      : defaultMaxTokens;

  if (request.thinkingEnabled) {
    const thinkingBudget = Math.max(0, request.thinkingBudgetTokens ?? 0);
    const minimumTotal = thinkingBudget + MIN_VISIBLE_OUTPUT_TOKENS;
    next = Math.max(next, Math.min(minimumTotal, maxAvailable));
  }

  return sanitizeTokenBudget(next);
}

function sanitizeTokenBudget(value: number): number {
  if (!Number.isFinite(value)) return MIN_VISIBLE_OUTPUT_TOKENS;
  return Math.max(1, Math.floor(value));
}
