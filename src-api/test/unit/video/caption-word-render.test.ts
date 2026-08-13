import { describe, expect, it } from 'vitest';

import {
  activeCaptionWordIndex,
  isAnimatedCaptionStyle,
  resolveCaptionWords,
} from '@/shared/video/caption-word-render';

const WORDS = [
  { text: 'one', fromFrame: 0, toFrame: 10 },
  { text: 'two', fromFrame: 10, toFrame: 20 },
  { text: 'three', fromFrame: 20, toFrame: 30 },
];

describe('caption word render model', () => {
  it('flags only per-word styles as animated', () => {
    expect(isAnimatedCaptionStyle('tiktok-word')).toBe(true);
    expect(isAnimatedCaptionStyle('hormozi-bold')).toBe(true);
    expect(isAnimatedCaptionStyle('karaoke')).toBe(true);
    expect(isAnimatedCaptionStyle('classic')).toBe(false);
    expect(isAnimatedCaptionStyle('none')).toBe(false);
    expect(isAnimatedCaptionStyle(undefined)).toBe(false);
  });

  it('finds the word being spoken at the frame', () => {
    expect(activeCaptionWordIndex(WORDS, 5)).toBe(0);
    expect(activeCaptionWordIndex(WORDS, 15)).toBe(1);
    expect(activeCaptionWordIndex(WORDS, 25)).toBe(2);
    // Past the end, the last started word stays active.
    expect(activeCaptionWordIndex(WORDS, 40)).toBe(2);
  });

  it('emphasizes only the active word for hormozi', () => {
    const rendered = resolveCaptionWords(WORDS, 15, 'hormozi-bold');
    expect(rendered.map((w) => w.emphasized)).toEqual([false, true, false]);
    expect(rendered.every((w) => w.visible)).toBe(true);
  });

  it('fills up to the active word for karaoke', () => {
    expect(
      resolveCaptionWords(WORDS, 15, 'karaoke').map((w) => w.emphasized),
    ).toEqual([true, true, false]);
  });

  it('reveals words progressively for tiktok-word', () => {
    expect(
      resolveCaptionWords(WORDS, 15, 'tiktok-word').map((w) => w.visible),
    ).toEqual([true, true, false]);
  });
});
