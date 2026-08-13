import type {
  RemotionCaption,
  RemotionCaptionWord,
} from './remotionPreviewData';

/**
 * Per-word caption animation model for the live preview. Mirrors the backend
 * render helper (`src-api/.../caption-word-render.ts`) so preview and export
 * agree on which word is emphasized and revealed at each frame.
 */

export const DEFAULT_CAPTION_ACCENT = '#ffe14d';

export function isAnimatedCaptionStyle(
  animation: RemotionCaption['animation'],
): boolean {
  return (
    animation === 'tiktok-word' ||
    animation === 'hormozi-bold' ||
    animation === 'karaoke'
  );
}

export function activeCaptionWordIndex(
  words: RemotionCaptionWord[],
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

export interface CaptionWordRender {
  text: string;
  visible: boolean;
  emphasized: boolean;
}

export function resolveCaptionWords(
  words: RemotionCaptionWord[],
  frame: number,
  animation: RemotionCaption['animation'],
): CaptionWordRender[] {
  const activeIndex = activeCaptionWordIndex(words, frame);
  return words.map((word, index) => ({
    text: word.text,
    visible: animation === 'tiktok-word' ? frame >= word.fromFrame : true,
    emphasized:
      animation === 'karaoke' ? index <= activeIndex : index === activeIndex,
  }));
}
