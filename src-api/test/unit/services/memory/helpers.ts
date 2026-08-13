import type {
  Memory,
  MemorySearchResult,
} from '@/shared/services/memory/types';

/** Create a mock Memory with sensible defaults. */
export function mockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? 'mem-1',
    content: overrides.content ?? 'Test memory content',
    category: overrides.category ?? 'fact',
    importance: overrides.importance ?? 0.7,
    source: overrides.source ?? 'manual',
    sessionId: overrides.sessionId ?? null,
    accessCount: overrides.accessCount ?? 0,
    lastAccessedAt: overrides.lastAccessedAt ?? null,
    hasEmbedding: overrides.hasEmbedding ?? false,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    memoryType: overrides.memoryType ?? 'semantic',
    scopeType: overrides.scopeType ?? 'global',
    scopeId: overrides.scopeId ?? null,
    decayRate: overrides.decayRate ?? 0.023,
    lastAccessedStrength: overrides.lastAccessedStrength ?? 1.0,
    confidence: overrides.confidence ?? 0.7,
    validFrom: overrides.validFrom ?? null,
    validUntil: overrides.validUntil ?? null,
    parentId: overrides.parentId ?? null,
    consolidatedFrom: overrides.consolidatedFrom ?? null,
    lifecycleStatus: overrides.lifecycleStatus ?? 'active',
    language: overrides.language ?? null,
    metadata: overrides.metadata ?? null,
    visibility: overrides.visibility ?? 'private',
  };
}

/** Create a mock MemorySearchResult. */
export function mockResult(
  overrides: Partial<Memory> = {},
  score = 0.85,
): MemorySearchResult {
  return { memory: mockMemory(overrides), score };
}

/** Create a date string N days in the past. */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
