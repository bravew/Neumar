import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { MarkdownProse } from '@/components/task/TaskV2MarkdownProse';
import type { DesignTaskRecord } from '@/shared/types/design-mode';

export function MediaProgressCard({
  task,
  projectFilePaths,
  onProjectFileOpen,
}: {
  task: DesignTaskRecord;
  projectFilePaths?: string[];
  onProjectFileOpen?: (path: string) => void;
}) {
  const failed = task.state === 'failed' || task.state === 'cancelled';
  const done = task.state === 'done';
  const lastLine = task.progressLines[task.progressLines.length - 1];
  return (
    <div className="border-border bg-card rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {task.surface} · {task.model}
          </h3>
          <p className="text-muted-foreground text-xs">
            {task.provider ?? 'Design dispatcher'} · {task.state}
          </p>
        </div>
        {done ? (
          <CheckCircle2 className="size-5 text-emerald-600" />
        ) : failed ? (
          <XCircle className="text-destructive size-5" />
        ) : (
          <Loader2 className="text-primary size-5 animate-spin" />
        )}
      </div>
      <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full transition-all"
          style={{
            width: done ? '100%' : failed ? '100%' : '45%',
          }}
        />
      </div>
      {lastLine && (
        <div className="text-muted-foreground mt-2 text-xs">
          <MarkdownProse
            animated={false}
            content={lastLine}
            projectFilePaths={projectFilePaths}
            onProjectFileOpen={onProjectFileOpen}
          />
        </div>
      )}
      {task.providerError && (
        <p className="text-destructive mt-2 text-xs">
          WARN: {task.providerError}
        </p>
      )}
    </div>
  );
}
