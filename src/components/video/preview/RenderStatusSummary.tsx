import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';

/**
 * Read-only summary of the project's last render: status, progress, where it
 * ran, cache hit/miss counts, and the output file's codec / duration / size /
 * loudness. Lives inside the render popover so users have one place to check
 * what the previous Re-render actually produced.
 */
export function RenderStatusSummary({
  project,
  aspect,
}: {
  project: VideoProject;
  aspect: VideoAspectRatio;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.renderSummary;
  const render = project.render;
  const output =
    project.outputs?.find((entry) => entry.aspectRatio === aspect) ??
    project.outputs?.[0];
  if (!render && !output) return null;
  return (
    <div className="border-border bg-muted/30 mb-3 space-y-1 rounded-md border p-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{labels.status}</span>
        <span className="text-foreground font-medium">
          {render?.status ?? 'idle'}
          {render?.status === 'running' && render?.progress != null
            ? ` · ${Math.round(render.progress)}%`
            : ''}
        </span>
      </div>
      {render?.message ? (
        <div className="text-muted-foreground truncate" title={render.message}>
          {render.message}
        </div>
      ) : null}
      {render?.where ? (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{labels.where}</span>
          <span className="text-foreground">
            {render.where}
            {render.provider ? ` · ${render.provider}` : ''}
          </span>
        </div>
      ) : null}
      {render?.cache ? (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{labels.sceneCache}</span>
          <span className="text-foreground">
            {labels.cacheHitMiss
              .replace('{hits}', String(render.cache.sceneHits))
              .replace('{misses}', String(render.cache.sceneMisses))}
          </span>
        </div>
      ) : null}
      {output ? (
        <>
          <div className="border-border my-1 border-t" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{labels.output}</span>
            <span className="text-foreground">
              {output.aspectRatio} · {output.codec}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{labels.duration}</span>
            <span className="text-foreground tabular-nums">
              {output.durationSec.toFixed(2)}s
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{labels.fileSize}</span>
            <span className="text-foreground tabular-nums">
              {formatBytes(output.fileSize)}
            </span>
          </div>
          {output.loudnessLufs != null ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{labels.loudness}</span>
              <span className="text-foreground tabular-nums">
                {output.loudnessLufs.toFixed(1)} LUFS
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
