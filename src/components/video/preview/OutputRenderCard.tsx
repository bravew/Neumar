import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoProject,
  VideoRenderOutput,
} from '@/shared/types/video';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** Total findings across every QA category, or undefined when no report ran. */
export function qaIssueCount(output: VideoRenderOutput): number | undefined {
  const report = output.qaReport;
  if (!report) return undefined;
  return (
    (report.blackFrames?.length ?? 0) +
    (report.audioClipping?.length ?? 0) +
    (report.silentGaps?.length ?? 0) +
    (report.missingMedia?.length ?? 0)
  );
}

/**
 * One rendered deliverable. A project renders per aspect ratio, so these are
 * the sibling cuts of the same edit — the thing you compare before shipping,
 * not a version history.
 */
export function OutputRenderCard({
  project,
  output,
  selected,
  onSelect,
}: {
  project: Pick<VideoProject, 'id' | 'render'>;
  output: VideoRenderOutput;
  selected: boolean;
  onSelect: (aspect: VideoAspectRatio) => void;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.preview;
  const issues = qaIssueCount(output);
  const poster = output.posterPath
    ? `${API_BASE_URL}/video/projects/${encodeURIComponent(
        project.id,
      )}/poster?aspectRatio=${encodeURIComponent(output.aspectRatio)}&v=${
        project.render?.updatedAt ?? ''
      }`
    : undefined;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(output.aspectRatio)}
      className={cn(
        'flex w-40 shrink-0 flex-col gap-1 rounded-md border p-2 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:bg-accent',
      )}
    >
      <span className="bg-muted flex aspect-video items-center justify-center overflow-hidden rounded">
        {poster ? (
          <img
            src={poster}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-muted-foreground text-[10px]">
            {output.aspectRatio}
          </span>
        )}
      </span>
      <span className="text-foreground text-xs font-medium">
        {output.aspectRatio}
      </span>
      <span className="text-muted-foreground text-[10px]">
        {[
          output.codec,
          output.durationSec ? formatDuration(output.durationSec) : undefined,
          output.fileSize ? formatBytes(output.fileSize) : undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {issues !== undefined ? (
        <span
          className={cn(
            'text-[10px]',
            issues > 0 ? 'text-warning-foreground' : 'text-muted-foreground',
          )}
        >
          {issues > 0
            ? labels.qaIssues.replace('{count}', String(issues))
            : labels.qaClean}
        </span>
      ) : null}
    </button>
  );
}
