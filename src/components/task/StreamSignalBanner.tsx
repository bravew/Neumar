import { AlertTriangle, Info, Lightbulb, RotateCcw, X } from 'lucide-react';

import { RateLimitIndicator } from '@/components/task/RateLimitIndicator';
import {
  useStreamSignals,
  type StreamSignalSource,
} from '@/shared/hooks/useStreamSignals';
import type {
  StreamNotice,
  StreamSignalState,
} from '@/shared/lib/stream-signals';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

/**
 * Agent runtime signals above the reply box: SDK notices, the rate-limit /
 * retry countdown, and a "waiting for input" status.
 */
export function StreamSignalBanner({
  agent,
  taskId,
}: {
  agent: StreamSignalSource;
  taskId: string | undefined;
}) {
  const { state, dismissNotice, clearRetry } = useStreamSignals(agent, taskId);
  return (
    <StreamSignalView
      state={state}
      onDismissNotice={dismissNotice}
      onRetryDone={clearRetry}
    />
  );
}

export function StreamSignalView({
  state,
  onDismissNotice,
  onRetryDone,
}: {
  state: StreamSignalState;
  onDismissNotice: (id: string) => void;
  onRetryDone: () => void;
}) {
  const { t } = useLanguage();
  const showStatus = state.sessionState === 'requires_action';
  if (!state.notices.length && !state.retry && !showStatus) return null;

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {state.notices.map((notice) => (
        <NoticeRow
          key={notice.id}
          notice={notice}
          dismissLabel={t.common.dismiss}
          onDismiss={() => onDismissNotice(notice.id)}
        />
      ))}
      {state.retry && (
        <RateLimitIndicator
          key={state.retry.until}
          retry={state.retry}
          onDismiss={onRetryDone}
        />
      )}
      {showStatus && (
        <div
          role="status"
          className="text-muted-foreground flex items-center gap-2 px-1 text-xs"
        >
          <span className="bg-primary inline-block size-1.5 animate-pulse rounded-full" />
          {t.task.streamSignalRequiresAction}
        </div>
      )}
    </div>
  );
}

function NoticeRow({
  notice,
  dismissLabel,
  onDismiss,
}: {
  notice: StreamNotice;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  const { tt } = useLanguage();
  let text: string;
  let tone: 'muted' | 'suggestion' | 'warning';
  switch (notice.kind) {
    case 'message':
      text = notice.content;
      tone = notice.level === 'notice' ? 'muted' : notice.level;
      break;
    case 'rate_limit_warning':
      text =
        notice.utilization !== undefined
          ? tt('task.streamSignalRateLimitWarning', {
              percent: Math.round(notice.utilization * 100),
            })
          : tt('task.streamSignalRateLimitWarningNoPercent');
      tone = 'warning';
      break;
    case 'plugin_errors':
      text = tt('task.streamSignalPluginErrors', { count: notice.count });
      tone = 'warning';
      break;
    case 'conversation_reset':
      text = tt('task.streamSignalConversationReset');
      tone = 'muted';
      break;
  }
  const Icon =
    notice.kind === 'conversation_reset'
      ? RotateCcw
      : tone === 'warning'
        ? AlertTriangle
        : tone === 'suggestion'
          ? Lightbulb
          : Info;

  return (
    <div
      role="status"
      data-tone={tone}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-1.5 text-xs',
        tone === 'warning' &&
          'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
        tone === 'suggestion' &&
          'border-primary/30 bg-primary/5 text-foreground',
        tone === 'muted' && 'border-border text-muted-foreground',
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        {text}
      </span>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="hover:text-foreground shrink-0 cursor-pointer opacity-60 hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
