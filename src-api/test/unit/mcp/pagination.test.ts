import { describe, expect, it } from 'vitest';

import { MAX_PAYLOAD_BYTES } from '@/shared/mcp/public-server/schemas';
import {
  capObject,
  paginateItems,
} from '@/shared/services/external-mcp/pagination';

describe('external MCP pagination', () => {
  it('pages and sets truncated when more items remain', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `id-${index}`,
      updatedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
      name: `row-${index}`,
    }));
    const page = paginateItems(items, {
      limit: 2,
      getKey: (item) => ({ updatedAt: item.updatedAt, id: item.id }),
    });
    expect(page.items).toHaveLength(2);
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).toBeTruthy();
    expect(page.byteLength).toBeGreaterThan(0);
  });

  it('throws PAYLOAD_TOO_LARGE when a single item exceeds the cap', () => {
    const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 32);
    expect(() =>
      paginateItems(
        [{ id: 'one', updatedAt: '2026-09-01T00:00:00.000Z', body: huge }],
        {
          limit: 1,
          getKey: (item) => ({ updatedAt: item.updatedAt, id: item.id }),
        },
      ),
    ).toThrow(/payload cap/i);
    expect(() => capObject({ body: huge })).toThrow(/payload cap/i);
  });
});
