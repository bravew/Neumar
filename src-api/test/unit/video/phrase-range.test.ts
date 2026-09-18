import { describe, expect, it } from 'vitest';

import {
  PhraseRangeError,
  resolvePhraseRange,
} from '@/shared/video/analysis/phrase-range';

const words = [
  { text: 'hello', startMs: 100, endMs: 300 },
  { text: 'brave', startMs: 350, endMs: 700 },
  { text: 'world', startMs: 800, endMs: 1200 },
  { text: 'hello', startMs: 2000, endMs: 2200 },
  { text: 'brave', startMs: 2300, endMs: 2600 },
  { text: 'world', startMs: 2700, endMs: 3100 },
];

describe('resolvePhraseRange', () => {
  it('selects occurrence and clamps padding to media bounds', () => {
    const first = resolvePhraseRange({
      words,
      phrase: 'hello brave',
      occurrence: 1,
      paddingMs: 500,
      durationMs: 3200,
    });
    expect(first).toMatchObject({
      startMs: 0,
      endMs: 1200,
      occurrence: 1,
      matchCount: 2,
    });
    const second = resolvePhraseRange({
      words,
      phrase: 'hello brave',
      occurrence: 2,
      paddingMs: 400,
      durationMs: 3200,
    });
    expect(second.startMs).toBe(1600);
    expect(second.endMs).toBe(3000);
  });

  it('throws a typed error when the phrase is missing', () => {
    try {
      resolvePhraseRange({
        words,
        phrase: 'not spoken',
        durationMs: 3200,
      });
      throw new Error('expected PhraseRangeError');
    } catch (error) {
      expect(error).toBeInstanceOf(PhraseRangeError);
      expect((error as PhraseRangeError).code).toBe('missing-phrase');
    }
  });
});
