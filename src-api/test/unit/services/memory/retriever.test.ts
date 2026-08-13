import { describe, expect, it, vi } from 'vitest';

import { llmRerank } from '@/shared/services/memory/retriever';

import { daysAgo, mockResult } from './helpers';

describe('llmRerank', () => {
  const candidates = [
    mockResult({ id: 'a', content: 'Memory A', createdAt: daysAgo(1) }, 0.9),
    mockResult({ id: 'b', content: 'Memory B', createdAt: daysAgo(2) }, 0.8),
    mockResult({ id: 'c', content: 'Memory C', createdAt: daysAgo(3) }, 0.7),
    mockResult({ id: 'd', content: 'Memory D', createdAt: daysAgo(4) }, 0.6),
    mockResult({ id: 'e', content: 'Memory E', createdAt: daysAgo(5) }, 0.5),
  ];

  it('skips LLM call when candidates <= limit', async () => {
    const callLLM = vi.fn();
    const result = await llmRerank(candidates.slice(0, 3), 'query', 5, callLLM);
    expect(callLLM).not.toHaveBeenCalled();
    expect(result).toHaveLength(3);
  });

  it('selects only LLM-chosen IDs, preserving score order', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"ids": ["c", "a"]}');
    const result = await llmRerank(candidates, 'query', 3, callLLM);

    expect(callLLM).toHaveBeenCalledOnce();
    // filter preserves candidates' score order: a (0.9) before c (0.7)
    expect(result[0]!.memory.id).toBe('a');
    expect(result[1]!.memory.id).toBe('c');
    // Third slot padded from remaining (b is next highest score)
    expect(result[2]!.memory.id).toBe('b');
    expect(result).toHaveLength(3);
  });

  it('falls back to score order when LLM returns invalid JSON', async () => {
    const callLLM = vi.fn().mockResolvedValue('not json at all');
    const result = await llmRerank(candidates, 'query', 2, callLLM);
    expect(result).toHaveLength(2);
    expect(result[0]!.memory.id).toBe('a'); // highest score
  });

  it('falls back to score order when LLM call throws', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('LLM down'));
    const result = await llmRerank(candidates, 'query', 2, callLLM);
    expect(result).toHaveLength(2);
    expect(result[0]!.memory.id).toBe('a');
  });

  it('pads results when LLM returns fewer IDs than limit', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"ids": ["d"]}');
    const result = await llmRerank(candidates, 'query', 3, callLLM);

    expect(result).toHaveLength(3);
    expect(result[0]!.memory.id).toBe('d'); // LLM selected
    // Next 2 padded from original order (a, b — skipping d)
    expect(result[1]!.memory.id).toBe('a');
    expect(result[2]!.memory.id).toBe('b');
  });

  it('passes query and manifest to the LLM prompt', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"ids": ["a"]}');
    await llmRerank(candidates, 'user preferences', 2, callLLM);

    const prompt = callLLM.mock.calls[0]![0] as string;
    expect(prompt).toContain('user preferences');
    expect(prompt).toContain('id=a');
    expect(prompt).toContain('id=e');
    expect(prompt).toContain('up to 2');
  });
});
