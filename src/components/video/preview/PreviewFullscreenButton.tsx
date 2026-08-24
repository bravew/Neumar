import { useCallback, useEffect, useState, type RefObject } from 'react';

import { Maximize, Minimize } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface PreviewFullscreenButtonProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Full-screen toggle for the main timeline preview.
 *
 * The WebCodecs canvas renders at proxy resolution (720p) for scrub
 * performance — the inline preview pane is often too small to judge detail
 * at that resolution. Full screen doesn't change the source, but blowing the
 * same frame up to the whole display is usually enough to tell if a shot is
 * sharp, and needs no change to the decode pipeline to get there.
 */
export function PreviewFullscreenButton({
  containerRef,
}: PreviewFullscreenButtonProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.preview;
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [containerRef]);

  // Tauri's webview sometimes intercepts the native Escape exit path,
  // leaving the maximized preview covering the app with no way back —
  // matches the same fallback RemotionPreview wires for its own player.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.fullscreenElement !== containerRef.current) return;
      event.preventDefault();
      void document.exitFullscreen();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [containerRef]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void containerRef.current?.requestFullscreen();
  }, [containerRef]);

  const label = isFullscreen ? labels.exitFullscreen : labels.fullscreen;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="border-border bg-background/90 text-foreground hover:bg-accent absolute top-2 left-2 z-30 flex size-7 items-center justify-center rounded-md border shadow-sm backdrop-blur"
      onClick={toggleFullscreen}
    >
      {isFullscreen ? (
        <Minimize className="size-3.5" />
      ) : (
        <Maximize className="size-3.5" />
      )}
    </button>
  );
}
