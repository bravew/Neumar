import { describe, expect, it } from 'vitest';

import {
  CAPTION_GLUE_MARK,
  captionWordGluedToPrevious,
  groupGluedCaptionWords,
  joinCaptionWords,
} from '../src';

const word = (text: string, startMs: number, endMs: number) => ({
  text,
  startMs,
  endMs,
});

describe('captionWordGluedToPrevious', () => {
  it.each([
    [
      'an unmarked tail that cannot start a word',
      word('Tra', 0, 200),
      word('nsformer.', 200, 500),
      true,
    ],
    [
      'a marked continuation, even with a gap',
      word('Tra', 0, 200),
      word(`${CAPTION_GLUE_MARK}nsformer`, 260, 500),
      true,
    ],
    [
      'a tail that does not abut',
      word('Tra', 0, 200),
      word('nsformer.', 210, 500),
      false,
    ],
    [
      'an ordinary word with an unusual opening',
      word('an', 0, 200),
      word('Xbox', 200, 500),
      false,
    ],
    [
      'a vowelless abbreviation',
      word('Hi', 0, 200),
      word('Mr', 200, 500),
      false,
    ],
    [
      'a zero-duration piece',
      word('Tra', 200, 200),
      word('nsformer.', 200, 500),
      false,
    ],
    [
      'a capitalized tail',
      word('Tra', 0, 200),
      word('Nsformer', 200, 500),
      false,
    ],
    [
      'a non-Latin seam',
      word('東京', 0, 200),
      word('nsformer', 200, 500),
      false,
    ],
  ])('%s', (_label, previous, next, glued) => {
    expect(captionWordGluedToPrevious(previous, next)).toBe(glued);
  });
});

describe('joinCaptionWords and groupGluedCaptionWords', () => {
  const words = [
    word('The', 0, 300),
    word('model', 300, 700),
    word('Tra', 700, 900),
    word('nsformer', 900, 1200),
    word(`${CAPTION_GLUE_MARK}s.`, 1200, 1400),
    word('Next', 1500, 1800),
  ];

  it('joins a glued run without spaces and keeps spaces elsewhere', () => {
    expect(joinCaptionWords(words)).toBe('The model Transformers. Next');
  });

  it('groups a glued run into one word spanning all of its pieces', () => {
    expect(groupGluedCaptionWords(words)).toEqual([
      word('The', 0, 300),
      word('model', 300, 700),
      word('Transformers.', 700, 1400),
      word('Next', 1500, 1800),
    ]);
  });

  it('does not change the words it groups', () => {
    const copy = structuredClone(words);
    groupGluedCaptionWords(words);
    expect(words).toEqual(copy);
  });

  it('leaves an unglued cue word for word', () => {
    const plain = [word('one', 0, 100), word('two', 100, 200)];
    expect(groupGluedCaptionWords(plain)).toEqual(plain);
    expect(joinCaptionWords(plain)).toBe('one two');
  });
});
