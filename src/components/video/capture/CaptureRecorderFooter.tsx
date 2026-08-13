import { Circle, Pause, Play, Square } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { formatElapsed } from './captureUtils';

type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

interface CaptureRecorderFooterProps {
  state: RecorderState;
  elapsedMs: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function CaptureRecorderFooter({
  state,
  elapsedMs,
  onStart,
  onPause,
  onResume,
  onStop,
}: CaptureRecorderFooterProps) {
  const { t } = useLanguage();
  return (
    <footer className="border-border flex items-center justify-between gap-3 border-t px-4 py-3">
      <span className="text-muted-foreground text-xs">
        {t.video.editor.capture.hud.elapsed.replace(
          '{elapsed}',
          formatElapsed(elapsedMs),
        )}
      </span>
      <div className="flex gap-2">
        {state === 'recording' ? (
          <button
            type="button"
            onClick={onPause}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs"
          >
            <Pause className="size-3" />
            {t.video.editor.capture.hud.pause}
          </button>
        ) : null}
        {state === 'paused' ? (
          <button
            type="button"
            onClick={onResume}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs"
          >
            <Play className="size-3" />
            {t.video.editor.capture.hud.resume}
          </button>
        ) : null}
        {state === 'idle' ? (
          <button
            type="button"
            onClick={onStart}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs"
          >
            <Circle className="size-3 fill-current" />
            {t.video.editor.capture.modal.start}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStop}
            disabled={state === 'saving'}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs disabled:opacity-50"
          >
            <Square className="size-3" />
            {state === 'saving'
              ? t.video.editor.capture.takeReview.saveSource
              : t.video.editor.capture.hud.stop}
          </button>
        )}
      </div>
    </footer>
  );
}
