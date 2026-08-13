import type { ProviderError } from './errors';

export interface FallbackTemplateInput {
  content: string;
  error: ProviderError;
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 2_000;

export function buildPlainTextFallback(input: FallbackTemplateInput): string {
  const maxLength = input.maxLength ?? DEFAULT_MAX_LENGTH;
  const suffix = `\n\nDelivery note: simplified after ${input.error.class}.`;
  const budget = Math.max(0, maxLength - suffix.length);
  const trimmed =
    input.content.length > budget
      ? `${input.content.slice(0, Math.max(0, budget - 3))}...`
      : input.content;
  const fallback = `${trimmed}${suffix}`;
  return fallback.length > maxLength ? fallback.slice(0, maxLength) : fallback;
}
