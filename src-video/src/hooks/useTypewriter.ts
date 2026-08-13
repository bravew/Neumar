import { useCurrentFrame } from 'remotion';

interface TypewriterOptions {
  text: string;
  startFrame?: number;
  charsPerFrame?: number;
}

/**
 * Returns the visible portion of text as if being typed character by character.
 * Also returns cursor blink state for rendering a blinking cursor.
 */
export function useTypewriter({
  text,
  startFrame = 0,
  charsPerFrame = 0.8,
}: TypewriterOptions) {
  const frame = useCurrentFrame();
  const relFrame = frame - startFrame;

  if (relFrame < 0) {
    return {
      visibleText: '',
      isTyping: false,
      cursorVisible: false,
      progress: 0,
    };
  }

  const charsToShow = Math.min(
    Math.floor(relFrame * charsPerFrame),
    text.length,
  );
  const visibleText = text.slice(0, charsToShow);
  const isTyping = charsToShow < text.length;
  const cursorVisible = frame % 30 < 15;
  const progress = charsToShow / text.length;

  return { visibleText, isTyping, cursorVisible, progress };
}
