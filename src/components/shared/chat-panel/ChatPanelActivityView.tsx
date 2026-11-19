import { Bot, Check, Circle, ListTodo, Loader2, X } from 'lucide-react';

import type {
  ChatPanelActivityMessage,
  ChatPanelSubagentMessage,
  ChatSubagentStatus,
} from './types';

export interface ChatPanelActivityLabels {
  /** Fallback title when the activity content carries no goal or message. */
  title: string;
  phase: Record<string, string>;
  step: Record<string, string>;
}

export interface ChatPanelSubagentLabels {
  title: string;
  status: Record<ChatSubagentStatus, string>;
}

/**
 * One AG-UI activity as a compact card. The plan/status payload is validated by
 * the adapter before it reaches here; this only chooses what to show.
 */
export function ActivityWidget({
  message,
  labels,
}: {
  message: ChatPanelActivityMessage;
  labels: ChatPanelActivityLabels;
}) {
  const { content } = message.activity;
  const goal =
    typeof content.goal === 'string'
      ? content.goal
      : typeof content.message === 'string'
        ? content.message
        : labels.title;
  const phase = typeof content.phase === 'string' ? content.phase : undefined;
  const steps = Array.isArray(content.steps)
    ? content.steps.filter(
        (step): step is Record<string, unknown> =>
          !!step && typeof step === 'object' && !Array.isArray(step),
      )
    : [];
  return (
    <section
      aria-label={labels.title}
      className="border-border/60 bg-muted/20 rounded-lg border p-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <ListTodo className="text-primary size-4 shrink-0" aria-hidden />
        <span className="text-foreground min-w-0 truncate font-medium">
          {goal}
        </span>
        {phase ? (
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {labels.phase[phase] ?? ''}
          </span>
        ) : null}
      </div>
      {steps.length > 0 ? (
        <ol className="mt-2 space-y-1">
          {steps.map((step, index) => {
            const status =
              typeof step.status === 'string' ? step.status : 'pending';
            return (
              <li
                key={typeof step.id === 'string' ? step.id : index}
                className="flex items-start gap-2 text-xs"
              >
                <ActivityStepIcon status={status} />
                <span className="text-foreground min-w-0 flex-1">
                  {typeof step.description === 'string' ? step.description : ''}
                </span>
                <span className="sr-only">{labels.step[status] ?? ''}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function ActivityStepIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return <Check className="size-3 shrink-0 text-emerald-500" aria-hidden />;
  }
  if (status === 'in_progress') {
    return (
      <Loader2
        className="text-primary size-3 shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (status === 'failed') {
    return <X className="text-destructive size-3 shrink-0" aria-hidden />;
  }
  return (
    <Circle className="text-muted-foreground size-3 shrink-0" aria-hidden />
  );
}

/** One line for a sub-agent invocation and the state it ended in. */
export function SubagentEvent({
  message,
  labels,
}: {
  message: ChatPanelSubagentMessage;
  labels: ChatPanelSubagentLabels;
}) {
  const { name, id, status } = message.subagent;
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <Bot className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="text-foreground min-w-0 truncate font-medium">
        {name || id.slice(0, 8)}
      </span>
      <span className="text-muted-foreground ml-auto shrink-0">
        {labels.status[status]}
      </span>
    </div>
  );
}
