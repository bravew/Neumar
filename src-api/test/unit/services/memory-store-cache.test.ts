import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import { getMemoryBudgetSupervisor } from '@/shared/services/memory-budget';
import {
  cacheEmbedding,
  enforceEmbeddingCacheBudget,
  getCachedEmbedding,
} from '@/shared/services/memory/store';

import { withTempHome } from '../../helpers/temp-home';

describe('memory embedding cache budget', () => {
  afterEach(() => {
    closeDatabase();
    getMemoryBudgetSupervisor().resetForTests();
  });

  it('evicts least-recently-accessed embedding cache rows', async () => {
    await withTempHome(async () => {
      closeDatabase();
      getMemoryBudgetSupervisor().resetForTests();

      try {
        cacheEmbedding('old content', 'old-model', new Float32Array(16));
        cacheEmbedding('new content', 'new-model', new Float32Array(16));

        const db = getDatabase();
        db.prepare(
          'UPDATE embedding_cache SET accessed_at = ? WHERE model = ?',
        ).run('2026-05-25T00:00:00.000Z', 'old-model');
        db.prepare(
          'UPDATE embedding_cache SET accessed_at = ? WHERE model = ?',
        ).run('2026-05-25T00:01:00.000Z', 'new-model');

        expect(enforceEmbeddingCacheBudget(80)).toBe(1);
        expect(getCachedEmbedding('old content', 'old-model')).toBeNull();
        expect(getCachedEmbedding('new content', 'new-model')).toBeInstanceOf(
          Float32Array,
        );
        expect(getMemoryBudgetSupervisor().getStatus()).toMatchObject({
          evictionCount: 1,
        });
      } finally {
        closeDatabase();
      }
    });
  });
});
