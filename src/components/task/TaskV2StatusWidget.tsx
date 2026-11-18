import { Loader2 } from 'lucide-react';

import type { StatusActivity } from '@/components/task/statusActivity';
import { useLanguage } from '@/shared/providers/language-provider';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * The planning progress line for the V2 thread. It is one AG-UI `status`
 * activity: the server patches its message and elapsed time in place, so this
 * renders a single row for the whole phase (the row's key is the activity id).
 *
 * It holds no interactive element, so patches cannot disturb focus or
 * collapse state. Only the label is announced to assistive technology; the
 * ticking elapsed time is hidden from it so a screen reader is not interrupted
 * every few seconds.
 */
export function StatusWidget({
  status,
  isRunning,
}: {
  status: StatusActivity;
  isRunning?: boolean;
}) {
  const { t } = useLanguage();
  // A planning phase left unsettled (a crash, a reload mid-run) must not
  // spin forever in a replayed thread.
  if (!isRunning) return null;

  const labels: Record<string, string> = {
    'Preparing...': t.task.planningPreparing,
    'Analyzing task...': t.task.planningAnalyzing,
    'Reasoning...': t.task.planningReasoning,
    'Thinking deeply...': t.task.planningThinkingDeeply,
  };
  const label = (status.message && labels[status.message]) || t.task.planning;

  return (
    <div role="status" className="mx-auto max-w-4xl px-4 py-1">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2
          className="size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span>{label}</span>
        {status.elapsedMs && status.elapsedMs > 0 ? (
          <span aria-hidden="true" className="tabular-nums">
            {formatElapsed(status.elapsedMs)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
