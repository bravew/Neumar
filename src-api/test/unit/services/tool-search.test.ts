import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_SEARCH_THRESHOLD,
  searchTools,
  shouldInjectToolSearch,
  toolSearchInputSchema,
  type ToolDescriptor,
} from '@/shared/mcp/tool-search';

const REGISTRY: ToolDescriptor[] = [
  { name: 'fs.read', description: 'Read a file from disk', source: 'builtin' },
  { name: 'fs.write', description: 'Write a file to disk', source: 'builtin' },
  {
    name: 'github.create_issue',
    description: 'Open an issue on GitHub',
    source: 'mcp:github',
  },
  {
    name: 'linear.create_ticket',
    description: 'Create a Linear ticket',
    source: 'mcp:linear',
  },
  {
    name: 'web.search',
    description: 'Search the web for information',
    source: 'builtin',
  },
];

describe('tool-search', () => {
  it('matches by name token', () => {
    const result = searchTools(REGISTRY, { query: 'read file', top_k: 3 });
    expect(result.searched).toBe(REGISTRY.length);
    expect(result.matches[0]?.name).toBe('fs.read');
  });

  it('returns top_k matches in score order', () => {
    const result = searchTools(REGISTRY, { query: 'create ticket', top_k: 2 });
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.name).toBe('linear.create_ticket');
  });

  it('returns no matches for unrelated queries', () => {
    const result = searchTools(REGISTRY, { query: 'xyzzy quantum', top_k: 5 });
    expect(result.matches).toEqual([]);
  });

  it('breaks ties deterministically by registry order', () => {
    // "file" matches both fs.read and fs.write equally.
    const result = searchTools(REGISTRY, { query: 'file', top_k: 5 });
    expect(result.matches.map((m) => m.name)).toEqual(['fs.read', 'fs.write']);
  });

  it('validates input', () => {
    expect(toolSearchInputSchema.parse({ query: 'hi' }).top_k).toBe(8);
    expect(
      toolSearchInputSchema.safeParse({ query: '', top_k: 5 }).success,
    ).toBe(false);
    expect(
      toolSearchInputSchema.safeParse({ query: 'x', top_k: 999 }).success,
    ).toBe(false);
  });

  it('shouldInjectToolSearch respects threshold', () => {
    expect(shouldInjectToolSearch(5)).toBe(false);
    expect(shouldInjectToolSearch(DEFAULT_TOOL_SEARCH_THRESHOLD)).toBe(false);
    expect(shouldInjectToolSearch(DEFAULT_TOOL_SEARCH_THRESHOLD + 1)).toBe(
      true,
    );
    expect(shouldInjectToolSearch(10, 5)).toBe(true);
  });
});
