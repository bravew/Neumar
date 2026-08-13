import { RefreshCw, XCircle } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAspectRatio, VideoJob } from '@/shared/types/video';

import { useRenderQueueJobs } from './useRenderQueueJobs';

interface RenderQueuePanelProps {
  projectId: string;
}

export function RenderQueuePanel({ projectId }: RenderQueuePanelProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.renderQueue;
  const { jobs, reload } = useRenderQueueJobs(projectId);
  const runningJobs = jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running',
  ).length;
  const summary = labels.summary
    .replace('{count}', String(jobs.length))
    .replace('{running}', String(runningJobs));

  const cancelJob = async (jobId: string) => {
    await fetch(
      `${API_BASE_URL}/video/render-queue/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' },
    );
    await reload();
  };

  if (jobs.length === 0) return null;

  return (
    <div className="pointer-events-none absolute right-4 bottom-14 left-4 z-30 flex justify-center">
      <div className="border-border bg-background/95 pointer-events-auto flex max-w-full items-center gap-3 rounded-md border px-3 py-1.5 text-xs shadow-lg shadow-black/20 backdrop-blur">
        <span className="sr-only" role="status" aria-live="polite" aria-atomic>
          {summary}
        </span>
        <div className="text-muted-foreground flex shrink-0 items-center gap-1.5 font-medium">
          <RefreshCw className="size-3" />
          {labels.title}
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          {jobs.slice(0, 4).map((job, index) => {
            const aspects = renderJobAspects(job).join(', ');
            return (
              <div
                key={job.id}
                className="border-border bg-muted/40 flex shrink-0 items-center gap-2 rounded-md border px-2 py-1"
              >
                <span className="text-foreground font-medium">
                  {statusLabel(labels.status, job.status)}
                </span>
                <span className="text-muted-foreground">
                  {labels.aspects.replace('{aspects}', aspects)}
                </span>
                {job.status === 'queued' || job.status === 'running' ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={labels.cancelJob
                      .replace('{index}', String(index + 1))
                      .replace('{aspects}', aspects)}
                    onClick={() => void cancelJob(job.id)}
                  >
                    <XCircle className="size-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function renderJobAspects(job: VideoJob): VideoAspectRatio[] {
  const value = job.payload.aspectRatios;
  if (!Array.isArray(value)) return ['16:9'];
  const aspects = value.filter(
    (item): item is VideoAspectRatio =>
      item === '16:9' || item === '9:16' || item === '1:1' || item === '4:5',
  );
  return aspects.length > 0 ? aspects : ['16:9'];
}

function statusLabel(
  labels: Record<string, string>,
  status: VideoJob['status'],
): string {
  return labels[status] ?? status;
}
