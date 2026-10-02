import { describe, expect, it } from 'vitest';

import { composerControlCount } from '@/components/shared/composer-controls';
import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas } from '@/shared/ideas/types';

describe('simple composer', () => {
  it('shows at most five controls', () => {
    expect(composerControlCount(true)).toBeLessThanOrEqual(5);
    expect(composerControlCount(true)).toBe(5);
  });

  it('offers the top three ideas', () => {
    const top = visibleIdeas(listIdeas(), undefined).slice(0, 3);
    expect(top).toHaveLength(3);
    expect(new Set(top.map((idea) => idea.id)).size).toBe(3);
  });
});
