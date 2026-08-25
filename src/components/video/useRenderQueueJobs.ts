import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { VideoJob } from '@/shared/types/video';

const VIDEO_JOB_KINDS = new Set<VideoJob['kind']>([
  'source-download',
  'source-analyze',
  'linked-source.sync',
  'clip-gen',
  'tts',
  'transcribe',
  'render',
  'editor-handoff',
  'reframe',
  'broll',
  'music',
  'eval',
]);

const VIDEO_JOB_STATUSES = new Set<VideoJob['status']>([
  'queued',
  'running',
  'done',
  'error',
  'cancelled',
]);

const VIDEO_JOB_CALLERS = new Set<VideoJob['caller']>([
  'in-app',
  'mcp',
  'agent',
]);

export function useRenderQueueJobs(
  projectId: string,
  {
    enabled = true,
    pollIntervalMs = 3000,
  }: { enabled?: boolean; pollIntervalMs?: number } = {},
) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  // Browsers allow ~6 sockets per host. When the API stalls (a large upload
  // hogging the event loop, say) an unguarded 3s poll stacks a new request on
  // every tick until the whole pool is queued behind them and *nothing* else in
  // the app — uploads, the folder picker — can reach the server again. Skip the
  // tick instead of piling on.
  const inFlightRef = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setJobs([]);
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch(
          `${API_BASE_URL}/video/render-queue?projectId=${encodeURIComponent(
            projectId,
          )}`,
          { signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as unknown;
        if (!signal?.aborted) setJobs(parseVideoJobs(data));
      } catch {
        if (!signal?.aborted) setJobs([]);
      } finally {
        inFlightRef.current = false;
      }
    },
    [enabled, projectId],
  );

  useEffect(() => {
    if (!enabled) {
      setJobs([]);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    const timer =
      pollIntervalMs > 0
        ? setInterval(() => {
            void load(controller.signal);
          }, pollIntervalMs)
        : null;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [enabled, load, pollIntervalMs]);

  return { jobs, reload: load };
}

function parseVideoJobs(data: unknown): VideoJob[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const jobs = (data as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.filter(isVideoJob);
}

function isVideoJob(value: unknown): value is VideoJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const job = value as Partial<VideoJob>;
  return (
    typeof job.id === 'string' &&
    typeof job.projectId === 'string' &&
    typeof job.payload === 'object' &&
    job.payload !== null &&
    !Array.isArray(job.payload) &&
    VIDEO_JOB_KINDS.has(job.kind as VideoJob['kind']) &&
    VIDEO_JOB_STATUSES.has(job.status as VideoJob['status']) &&
    VIDEO_JOB_CALLERS.has(job.caller as VideoJob['caller'])
  );
}
