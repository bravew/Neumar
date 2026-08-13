import { useCallback, useEffect, useState } from 'react';

import * as Popover from '@radix-ui/react-popover';
import {
  Archive,
  CheckCircle2,
  Clipboard,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoEditorHandoffJobStatus,
  VideoEditorHandoffMediaMode,
  VideoEditorHandoffTarget,
  VideoJob,
} from '@/shared/types/video';

import {
  HandoffTargetIcon,
  type DisplayHandoffTarget,
} from './HandoffTargetIcon';

const TARGETS: DisplayHandoffTarget[] = [
  'final-cut-pro',
  'premiere-pro',
  'resolve',
  'otio',
  'edl',
  'capcut-fallback',
];

interface EditorHandoffExportProps {
  onQueue: (input: {
    targets: VideoEditorHandoffTarget[];
    mediaMode?: VideoEditorHandoffMediaMode;
  }) => Promise<VideoJob | null>;
  onGetJob: (
    jobId: string,
    signal?: AbortSignal,
  ) => Promise<VideoEditorHandoffJobStatus | null>;
}

export function EditorHandoffExport({
  onQueue,
  onGetJob,
}: EditorHandoffExportProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.preview.handoff;
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<VideoEditorHandoffTarget[]>([
    'final-cut-pro',
    'premiere-pro',
    'resolve',
  ]);
  const [mediaMode, setMediaMode] =
    useState<VideoEditorHandoffMediaMode>('copy');
  const [status, setStatus] = useState<VideoEditorHandoffJobStatus | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const job = status?.job;
  const isRunning =
    submitting || job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await onGetJob(job.id, controller.signal);
        if (!controller.signal.aborted && next) {
          setStatus(next);
          if (next.job.status === 'queued' || next.job.status === 'running') {
            timer = window.setTimeout(poll, 2000);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      }
    };
    timer = window.setTimeout(poll, 1000);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [job, onGetJob]);

  const toggleTarget = useCallback((target: VideoEditorHandoffTarget) => {
    setTargets((current) =>
      current.includes(target)
        ? current.filter((item) => item !== target)
        : [...current, target],
    );
  }, []);

  const handleExport = useCallback(async () => {
    const selectedTargets: VideoEditorHandoffTarget[] =
      targets.length > 0 ? targets : ['neuma-package'];
    setSubmitting(true);
    try {
      const nextJob = await onQueue({
        targets: selectedTargets,
        mediaMode,
      });
      if (nextJob) setStatus({ job: nextJob });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [mediaMode, onQueue, targets]);

  const handleReveal = useCallback(async () => {
    if (!status?.packagePath) return;
    try {
      const response = await fetch(`${API_BASE_URL}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: status.packagePath }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [status?.packagePath]);

  const handleCopy = useCallback(async () => {
    if (!status?.packagePath) return;
    try {
      await navigator.clipboard.writeText(status.packagePath);
      toast.success(labels.copied);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [labels.copied, status?.packagePath]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="border-border hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
        >
          <Archive className="size-3.5" />
          {labels.title}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="bg-popover text-popover-foreground z-50 w-80 rounded-md border p-3 text-xs shadow-md"
        >
          <div className="space-y-3">
            <div>
              <div className="font-medium">{labels.targets}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {TARGETS.map((target) => (
                  <label
                    key={target}
                    className={cn(
                      'border-border hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors',
                      targets.includes(target) &&
                        'border-primary bg-primary/10',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-primary shrink-0"
                      checked={targets.includes(target)}
                      onChange={() => toggleTarget(target)}
                    />
                    <HandoffTargetIcon target={target} />
                    <span className="min-w-0 truncate">
                      {labels.target[target]}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="font-medium">{labels.mediaMode}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['copy', 'link'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMediaMode(mode)}
                    className={`rounded-md border px-2 py-1.5 text-left ${
                      mediaMode === mode
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-accent'
                    }`}
                  >
                    {labels.mediaModeValue[mode]}
                  </button>
                ))}
              </div>
            </div>
            {status ? (
              <div className="border-border rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span>{labels.status}</span>
                  <span className="font-medium">
                    {labels.jobStatus[status.job.status]}
                  </span>
                </div>
                {status.conformance ? (
                  <div className="text-muted-foreground mt-1">
                    {labels.conformance
                      .replace(
                        '{warnings}',
                        String(status.conformance.warningCount),
                      )
                      .replace(
                        '{errors}',
                        String(status.conformance.errorCount),
                      )}
                  </div>
                ) : null}
                {status.packagePath ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleReveal}
                      className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1"
                    >
                      <FolderOpen className="size-3" />
                      {labels.reveal}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1"
                    >
                      <Clipboard className="size-3" />
                      {labels.copyPath}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="text-muted-foreground">{labels.unverified}</div>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={isRunning}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium disabled:opacity-60"
            >
              {isRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              {labels.export}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
