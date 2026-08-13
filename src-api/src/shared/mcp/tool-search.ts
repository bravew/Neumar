// Pure matcher for the mcp.tool_search synthetic tool. No I/O.

import { z } from 'zod';

import type { RiskLevel } from '@/shared/services/ag-ui/event-schema';
import { RiskLevelSchema } from '@/shared/services/ag-ui/event-schema';

export const DEFAULT_TOOL_SEARCH_THRESHOLD = 30;
export const TOOL_SEARCH_THRESHOLD_SETTING_KEY = 'toolSearchThreshold';

export interface ToolDescriptor {
  name: string;
  description: string;
  /** `mcp:<server>`, `builtin`, `skill:<id>`. */
  source: string;
  riskHint?: RiskLevel;
}

export const toolSearchInputSchema = z.object({
  query: z.string().min(1).max(500),
  top_k: z.number().int().min(1).max(50).default(8),
});

export type ToolSearchInput = z.infer<typeof toolSearchInputSchema>;

export interface ToolSearchResult {
  matches: ToolDescriptor[];
  searched: number;
}

export const toolDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  source: z.string().min(1),
  riskHint: RiskLevelSchema.optional(),
});

export const TOOL_SEARCH_TOOL_NAME = 'mcp.tool_search';

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'and',
  'or',
  'find',
  'list',
  'show',
  'me',
  'what',
  'how',
  'i',
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface ScoreContext {
  queryLower: string;
  queryTokens: string[];
}

function scoreDescriptor(
  descriptor: ToolDescriptor,
  ctx: ScoreContext,
): number {
  const haystackName = descriptor.name.toLowerCase();
  const haystackDesc = descriptor.description.toLowerCase();

  let score = 0;
  if (haystackName.includes(ctx.queryLower)) score += 10;
  if (haystackDesc.includes(ctx.queryLower)) score += 4;
  for (const token of ctx.queryTokens) {
    if (haystackName.includes(token)) score += 3;
    if (haystackDesc.includes(token)) score += 1;
  }
  return score;
}

/** Stable: ties break by registry order so output is deterministic. */
export function searchTools(
  registry: readonly ToolDescriptor[],
  input: ToolSearchInput,
): ToolSearchResult {
  const ctx: ScoreContext = {
    queryLower: input.query.toLowerCase(),
    queryTokens: tokenize(input.query),
  };
  const ranked = registry
    .map((descriptor, index) => ({
      descriptor,
      score: scoreDescriptor(descriptor, ctx),
      index,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, input.top_k)
    .map((entry) => entry.descriptor);

  return { matches: ranked, searched: registry.length };
}

export function shouldInjectToolSearch(
  registrySize: number,
  threshold: number = DEFAULT_TOOL_SEARCH_THRESHOLD,
): boolean {
  return registrySize > Math.max(1, threshold);
}
