import { describe, expect, it } from 'vitest';

import ideasEn from '@/config/locale/messages/en/ideas';
import { ideaPrompt, scopedPrompt } from '@/shared/ideas/idea-text';
import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas } from '@/shared/ideas/types';

import { readFileSync } from 'node:fs';
import path from 'node:path';

const LOCALES = ['en', 'zh', 'es', 'fr', 'hi', 'pt'];

function ideaById(id: string) {
  const idea = listIdeas().find((entry) => entry.id === id);
  if (!idea) throw new Error(`missing idea ${id}`);
  return idea;
}

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

  it('ranks "more like this" ideas first and keeps registry order otherwise', () => {
    const ids = listIdeas().map((idea) => idea.id);
    const last = ids[ids.length - 1];
    const ranked = visibleIdeas(listIdeas(), { [last]: 'more' }).map(
      (idea) => idea.id,
    );
    expect(ranked).toEqual([last, ...ids.slice(0, -1)]);
  });

  it('resolves a prefill prompt and leaves other actions empty', () => {
    expect(ideaPrompt(ideasEn, ideaById('draft-email'))).toBe(
      ideasEn.prompt.draftEmail,
    );
    expect(ideaPrompt(ideasEn, ideaById('browse-library'))).toBe('');
  });

  it('keeps the idea and its questions in a scoped prompt', () => {
    const report = ideaById('weekly-report');
    expect(scopedPrompt(ideasEn, report, ['The team', '', 'One page'])).toBe(
      [
        ideasEn.promise.weeklyReport,
        `${ideasEn.question.audience} The team`,
        `${ideasEn.question.format} One page`,
      ].join('\n'),
    );
  });
});
