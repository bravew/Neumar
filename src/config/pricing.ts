/**
 * Model pricing data for cost estimation (per million tokens)
 */

interface ModelPricing {
  input: number; // $ per million input tokens
  output: number; // $ per million output tokens
  label: string;
}

const TOKENS_PER_MILLION = 1_000_000;

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5': { input: 5.0, output: 25.0, label: 'Opus 5' },
  'claude-fable-5': { input: 10.0, output: 50.0, label: 'Fable 5' },
  'claude-mythos-5': { input: 10.0, output: 50.0, label: 'Mythos 5' },
  // Introductory standard non-batch API price through 2026-08-31.
  'claude-sonnet-5': { input: 2.0, output: 10.0, label: 'Sonnet 5' },
  'claude-haiku-4-5': { input: 0.8, output: 4.0, label: 'Haiku 4.5' },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, label: 'Sonnet 4.6' },
  'claude-opus-4-6': { input: 5.0, output: 25.0, label: 'Opus 4.6' },
  'claude-opus-4-8': { input: 5.0, output: 25.0, label: 'Opus 4.8' },
  'claude-opus-4-7': { input: 5.0, output: 25.0, label: 'Opus 4.7' },
};

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  modelKey: string,
): number | null {
  const pricing = MODEL_PRICING[modelKey];
  if (!pricing) return null;
  return (
    (inputTokens * pricing.input + outputTokens * pricing.output) /
    TOKENS_PER_MILLION
  );
}

export function estimateAllModelCosts(
  inputTokens: number,
  outputTokens: number,
): Array<{ key: string; label: string; cost: number }> {
  return Object.entries(MODEL_PRICING).map(([key, pricing]) => ({
    key,
    label: pricing.label,
    cost:
      (inputTokens * pricing.input + outputTokens * pricing.output) /
      TOKENS_PER_MILLION,
  }));
}
