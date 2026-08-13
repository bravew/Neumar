import { X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';
import { useRenderStream } from '@/shared/video/useRenderStream';

/**
 * Always-visible render progress strip shown above the bottom action bar
 * while `render.status === 'running'`. Mirrors the pattern from
 * `_sample/video-studio` (inline percentage + bar + cancel) but lives outside
 * the popover so the user can continue editing without keeping the popover
 * open. Renders an indeterminate animation when the pipeline hasn't reported
 * a numeric `progress` yet (e.g. during scene materialization).
 */
export function RenderProgressBar({
  project,
  onCancel,
}: {
  project: VideoProject;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const render = project.render;
  const running = render?.status === 'running';
  // Phase 6 M4 — subscribe to the live render stream while a render is in
  // flight so progress updates without waiting on the next project poll, and
  // survives a dropped connection (resume-from-seq on reconnect).
  const stream = useRenderStream(project.id, running);
  if (!running) return null;

  const labels = t.video.editor.renderProgress;
  const liveProgress = stream.progress ?? render.progress;
  const percent = liveProgress != null ? Math.round(liveProgress) : null;
  const message = stream.message ?? render.message ?? labels.running;

  return (
    <div
      className="border-border bg-muted/30 flex shrink-0 items-center gap-3 border-t px-4 py-2 text-xs"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground truncate" title={message}>
            {message}
          </span>
          {percent != null ? (
            <span className="text-muted-foreground tabular-nums">
              {percent}%
            </span>
          ) : null}
        </div>
        <div
          className="bg-border h-1.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          {percent != null ? (
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="bg-primary/70 h-full w-1/3 animate-pulse rounded-full" />
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label={labels.cancel}
        className="border-border hover:bg-accent text-foreground inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1"
      >
        <X className="size-3" />
        {labels.cancel}
      </button>
    </div>
  );
}
