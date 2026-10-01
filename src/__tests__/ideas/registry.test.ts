import { describe, expect, it } from 'vitest';

import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas } from '@/shared/ideas/types';

import { readFileSync } from 'node:fs';
import path from 'node:path';

const LOCALES = ['en', 'zh', 'es', 'fr', 'hi', 'pt'];

describe('ideas registry', () => {
  it('uses unique ids', () => {
    const ids = listIdeas().map((idea) => idea.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps scoping questions to three', () => {
    for (const idea of listIdeas()) {
      if (idea.action.kind !== 'scoping') continue;
      expect(idea.action.questions.length).toBeLessThanOrEqual(3);
    }
  });

  it('has every idea key in all six locales', () => {
    const keys = listIdeas().flatMap((idea) => [
      idea.promiseKey.split('.').pop() ?? '',
      idea.howKey.split('.').pop() ?? '',
      idea.categoryKey.split('.').pop() ?? '',
    ]);
    for (const locale of LOCALES) {
      const source = readFileSync(
        path.resolve('src/config/locale/messages', locale, 'ideas.ts'),
        'utf8',
      );
      for (const key of keys) {
        expect(source).toContain(`${key}:`);
      }
    }
  });

  it('hides an idea after it is marked not interested', () => {
    const ideas = listIdeas();
    const hidden = visibleIdeas(ideas, { [ideas[0].id]: 'dismissed' });
    expect(hidden.map((idea) => idea.id)).not.toContain(ideas[0].id);
    expect(hidden).toHaveLength(ideas.length - 1);
  });
});
