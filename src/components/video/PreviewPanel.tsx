import { useState } from 'react';

import { PlayCircle } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';

import { PanelShell } from './PanelShell';
import { DEFAULT_PREVIEW_PLAYBACK_RATE } from './preview/previewPlaybackRate';
import { PreviewRenderer } from './preview/PreviewRenderer';

interface PreviewPanelProps {
  project?: VideoProject;
  onRender?: (aspectRatio: VideoAspectRatio) => Promise<unknown>;
  onCancel?: () => Promise<unknown>;
}

const ASPECTS: VideoAspectRatio[] = ['16:9', '9:16', '1:1'];

export function PreviewPanel({
  project,
  onRender,
  onCancel,
}: PreviewPanelProps) {
  const { t } = useLanguage();
  const [selectedAspect, setSelectedAspect] =
    useState<VideoAspectRatio>('16:9');
  const [busy, setBusy] = useState(false);
  const status = project?.render?.status ?? 'idle';
  const progress = project?.render?.progress;
  const message = project?.render?.message;
  const fallbackCount = project?.render?.transitions?.degraded.length ?? 0;
  const hasOutput = Boolean(
    project?.outputs?.length || project?.render?.outputPath,
  );
  const hasTimelinePreview = Boolean(
    project?.timeline || project?.storyboard?.scenes.length,
  );
  const videoSrc =
    project?.id && hasOutput
      ? `${API_BASE_URL}/video/projects/${encodeURIComponent(
          project.id,
        )}/output?aspectRatio=${encodeURIComponent(selectedAspect)}&v=${
          project.render?.updatedAt ?? ''
        }`
      : undefined;

  const render = async () => {
    setBusy(true);
    try {
      await onRender?.(selectedAspect);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelShell
      title={t.video.preview.title}
      description={t.video.preview.description}
    >
      <div className="space-y-3">
        <div className="border-border bg-muted/30 flex aspect-video items-center justify-center overflow-hidden rounded-md border border-dashed">
          {project && hasTimelinePreview ? (
            <PreviewRenderer
              project={project}
              aspectRatio={selectedAspect}
              playbackRate={DEFAULT_PREVIEW_PLAYBACK_RATE}
            />
          ) : videoSrc ? (
            <video
              key={videoSrc}
              controls
              src={videoSrc}
              className="size-full object-contain"
            />
          ) : (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <PlayCircle className="size-4" />
              <span>{t.video.preview.status.replace('{status}', status)}</span>
            </div>
          )}
        </div>
        {status === 'running' ? (
          <div className="space-y-1">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-[width]"
                style={{
                  width: `${Math.max(0, Math.min(100, progress ?? 0))}%`,
                }}
              />
            </div>
            {message ? (
              <p className="text-muted-foreground text-xs">{message}</p>
            ) : null}
          </div>
        ) : null}
        {status === 'error' && message ? (
          <p className="text-destructive text-xs">{message}</p>
        ) : null}
        {fallbackCount > 0 ? (
          <p className="border-warning/30 bg-warning/10 text-warning-foreground rounded-md border px-3 py-2 text-xs">
            {t.video.preview.transitionFallback.replace(
              '{count}',
              String(fallbackCount),
            )}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {ASPECTS.map((aspect) => (
            <button
              type="button"
              key={aspect}
              onClick={() => setSelectedAspect(aspect)}
              className={
                selectedAspect === aspect
                  ? 'bg-primary text-primary-foreground rounded-md px-2 py-1 text-xs'
                  : 'border-border hover:bg-accent rounded-md border px-2 py-1 text-xs'
              }
            >
              {aspect}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={render}
            disabled={busy || status === 'running'}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
          >
            {status === 'done'
              ? t.video.preview.rerender
              : t.video.preview.render}
          </button>
          <button
            type="button"
            onClick={() => void onCancel?.()}
            disabled={status !== 'running'}
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-60"
          >
            {t.video.preview.cancel}
          </button>
          <span className="text-muted-foreground text-xs">
            {t.video.preview.status.replace('{status}', status)}
          </span>
        </div>
      </div>
    </PanelShell>
  );
}
