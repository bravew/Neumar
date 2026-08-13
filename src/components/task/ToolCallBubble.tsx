import type { ToolCallMessagePartProps } from '@assistant-ui/react';

import {
  humanizeToolName,
  statusAwareToolLabel,
} from '@/components/task/tool-execution/tool-utils';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

type Status = {
  type: 'running' | 'complete' | 'incomplete' | 'requires-action';
};

interface Props {
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: Status;
  // Allow passing a raw ToolCallMessagePartProps for MessagePrimitive.Parts usage
  part?: ToolCallMessagePartProps;
}

/**
 * Tense-aware tool call bubble for the AG-UI task view.
 * Shows "Reading…" while running, "Read file" when complete.
 * Used inside TaskV2Thread / MessagePrimitive.Parts.
 */
export function ToolCallBubble({
  toolName,
  args,
  result: _result,
  status,
  part,
}: Props) {
  const { t } = useLanguage();
  const name = part?.toolName ?? toolName ?? 'tool';
  const resolvedArgs = (part?.args ?? args) as
    | Record<string, unknown>
    | undefined;
  const resolvedStatus = (part?.status as Status | undefined) ?? status;

  const isRunning = resolvedStatus?.type === 'running';
  const isFailed = resolvedStatus?.type === 'incomplete';

  const label = isRunning
    ? statusAwareToolLabel(name, 'running')
    : isFailed
      ? (t.task.toolFailed ?? '{tool} failed').replace(
          '{tool}',
          humanizeToolName(name),
        )
      : statusAwareToolLabel(name, 'done');

  const argKeys = Object.keys(resolvedArgs ?? {}).slice(0, 2);

  return (
    <div
      className={cn(
        'border-border/40 bg-background/60 my-1 flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs',
        isRunning && 'animate-pulse',
        isFailed && 'border-destructive/40 text-destructive',
      )}
    >
      <span className="shrink-0 opacity-60">
        {isRunning ? '⟳' : isFailed ? '✗' : '✓'}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {argKeys.map((k) => (
        <span key={k} className="bg-muted text-muted-foreground rounded px-1">
          {k}
        </span>
      ))}
    </div>
  );
}
