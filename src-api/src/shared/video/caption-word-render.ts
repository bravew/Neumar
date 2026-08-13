/**
 * Per-word caption animation model, shared shape between the headless render
 * composition and the live preview. Given a cue's words (each with frame
 * timings relative to the cue start) and the current frame, it decides which
 * words are on screen and which are emphasized, so `tiktok-word`, `hormozi-bold`
 * and `karaoke` styles animate word-by-word instead of showing a static block.
 */

export type CaptionAnimation =
  | 'tiktok-word'
  | 'hormozi-bold'
  | 'classic'
  | 'karaoke'
  | 'none';

export interface CaptionWordFrame {
  text: string;
  /** Frame the word becomes active, relative to the cue's start. */
  fromFrame: number;
  /** Frame the word stops being active, relative to the cue's start. */
  toFrame: number;
}

export interface CaptionWordRender {
  text: string;
  /** Whether the word is on screen at this frame (tiktok reveals gradually). */
  visible: boolean;
  /** Whether the word should get the accent color / scale at this frame. */
  emphasized: boolean;
}

/** Only these styles animate per word; everything else renders the whole cue. */
export function isAnimatedCaptionStyle(
  animation: CaptionAnimation | undefined,
): boolean {
  return (
    animation === 'tiktok-word' ||
    animation === 'hormozi-bold' ||
    animation === 'karaoke'
  );
}

/** The word index active at `frame` — the one being spoken, else the last one started. */
export function activeCaptionWordIndex(
  words: CaptionWordFrame[],
  frame: number,
): number {
  let started = -1;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    if (frame >= word.fromFrame && frame < word.toFrame) return i;
    if (frame >= word.fromFrame) started = i;
  }
  return started;
}

export function resolveCaptionWords(
  words: CaptionWordFrame[],
  frame: number,
  animation: CaptionAnimation | undefined,
): CaptionWordRender[] {
  const activeIndex = activeCaptionWordIndex(words, frame);
  return words.map((word, index) => ({
    text: word.text,
    // TikTok-style reveals words as they are spoken; the others show the full
    // line and only move the emphasis.
    visible: animation === 'tiktok-word' ? frame >= word.fromFrame : true,
    // Karaoke fills up to the current word; the others emphasize only it.
    emphasized:
      animation === 'karaoke' ? index <= activeIndex : index === activeIndex,
  }));
}

/** Accent color for the emphasized word when the style doesn't specify one. */
export const DEFAULT_CAPTION_ACCENT = '#ffe14d';
