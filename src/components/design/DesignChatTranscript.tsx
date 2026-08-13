import { useEffect, useRef, useState } from 'react';

import {
  Check,
  ChevronRight,
  Loader2,
  MessageCircleQuestion,
  Minus,
  Wrench,
  X,
} from 'lucide-react';

import { GenUIRenderer, MessageBubble } from '@/components/shared/chat-panel';
import type {
  DesignChatToolCall,
  DesignChatTurn,
} from '@/shared/hooks/useDesignChat';
import { cn } from '@/shared/lib/utils';
import { parseGenUIEnvelope } from '@/shared/types/gen-ui';

/**
 * DesignMode conversational transcript (Fix-sync Phase 02). Renders the
 * turn-based stream from `useDesignChat`: a user bubble, then a streaming
 * assistant turn with text, tool-call rows, and a status indicator — the
 * Studio-parity chat experience. Artifacts the agent writes land in the
 * FileWorkspace, not here.
 */
export function DesignChatTranscript({
  turns,
  emptyState,
  errorFallback,
  askCardLabel,
  askCardAnsweredLabel,
  onOpenQuestions,
}: {
  turns: DesignChatTurn[];
  emptyState?: React.ReactNode;
  errorFallback: string;
  /** Localized "Mind if I ask a couple of quick questions?" entry-card label. */
  askCardLabel?: string;
  /** Localized "Questions answered" label for an answered discovery card. */
  askCardAnsweredLabel?: string;
  /** Open the Questions tab from a transcript discovery entry card. */
  onOpenQuestions?: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Scroll to the bottom when a turn is added or while the latest turn is still
  // streaming — not on every tool-status flip, which would yank long
  // transcripts mid-read.
  const turnCount = turns.length;
  const lastStreaming = turns[turns.length - 1]?.status === 'streaming';
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turnCount, lastStreaming]);

  if (turns.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="space-y-3" data-testid="design-chat-transcript">
      {turns.map((turn, i) =>
        turn.role === 'user' ? (
          <MessageBubble key={turn.id} role="user" className="text-sm">
            <div className="whitespace-pre-wrap">{turn.text}</div>
          </MessageBubble>
        ) : (
          <MessageBubble key={turn.id} role="assistant" className="text-sm">
            <AssistantTurn
              turn={turn}
              errorFallback={errorFallback}
              askCardLabel={askCardLabel}
              askCardAnsweredLabel={askCardAnsweredLabel}
              // A question is "answered" once a later turn exists (the answer turn
              // and build follow it); only an open question is the last turn. The
              // following user turn carries the "question → answer" lines.
              questionAnswered={i < turns.length - 1}
              answerText={
                turns[i + 1]?.role === 'user' ? turns[i + 1].text : undefined
              }
              onOpenQuestions={onOpenQuestions}
            />
          </MessageBubble>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function AssistantTurn({
  turn,
  errorFallback,
  askCardLabel,
  askCardAnsweredLabel,
  questionAnswered,
  answerText,
  onOpenQuestions,
}: {
  turn: DesignChatTurn;
  errorFallback: string;
  askCardLabel?: string;
  askCardAnsweredLabel?: string;
  questionAnswered?: boolean;
  answerText?: string;
  onOpenQuestions?: () => void;
}) {
  const text = turn.text.trim();
  const genUI = parseGenUIEnvelope(text);
  const hasQuestions = turn.questions.length > 0;
  return (
    <div className="space-y-1.5" data-testid="design-chat-assistant-turn">
      {genUI ? (
        <GenUIRenderer envelope={genUI} />
      ) : text ? (
        <div className="text-foreground text-sm whitespace-pre-wrap">
          {text}
        </div>
      ) : null}
      {hasQuestions &&
        askCardLabel &&
        // Answered → an expandable card revealing the Q&A; while open, a
        // clickable card that focuses the Questions tab.
        (questionAnswered ? (
          <AnsweredQuestionCard
            label={askCardAnsweredLabel ?? askCardLabel}
            answerText={answerText}
          />
        ) : (
          <button
            type="button"
            onClick={onOpenQuestions}
            className="border-border hover:bg-accent/50 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm"
            data-testid="design-chat-ask-card"
          >
            <MessageCircleQuestion className="text-primary size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{askCardLabel}</span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          </button>
        ))}
      {turn.tools.length > 0 && (
        <ToolGroup tools={turn.tools} streaming={turn.status === 'streaming'} />
      )}
      {turn.status === 'streaming' &&
        !text &&
        !hasQuestions &&
        turn.tools.length === 0 && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" />
          </div>
        )}
      {turn.status === 'error' && (
        <div
          className={cn(
            'text-destructive border-destructive/30 rounded-md border p-2 text-xs',
          )}
        >
          {turn.error ?? errorFallback}
        </div>
      )}
      {turn.status === 'done' && turn.usage && (
        <div
          className="text-muted-foreground flex items-center gap-2 text-[11px] tabular-nums"
          data-testid="design-chat-usage"
        >
          {formatUsage(turn.usage)}
        </div>
      )}
    </div>
  );
}

/**
 * Answered discovery questions — an expandable card. Collapsed shows "Questions
 * answered"; expanded reveals the submitted "question → answer" pairs (parsed
 * from the following user turn's text).
 */
function AnsweredQuestionCard({
  label,
  answerText,
}: {
  label: string;
  answerText?: string;
}) {
  const [open, setOpen] = useState(false);
  const rows = (answerText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('→');
      return idx === -1
        ? { q: '', a: line }
        : { q: line.slice(0, idx).trim(), a: line.slice(idx + 1).trim() };
    });
  const canExpand = rows.length > 0;
  return (
    <div
      className="border-border overflow-hidden rounded-md border"
      data-testid="design-chat-ask-card-answered"
    >
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        className="text-muted-foreground hover:bg-accent/50 flex w-full items-center gap-2 px-2.5 py-2 text-sm"
        aria-expanded={open}
      >
        <Check className="size-4 shrink-0 text-emerald-500" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {canExpand && (
          <ChevronRight
            className={cn('size-4 shrink-0 transition-transform', {
              'rotate-90': open,
            })}
          />
        )}
      </button>
      {open && canExpand && (
        <ul className="border-border space-y-2 border-t px-2.5 py-2 text-xs">
          {rows.map((row, i) => (
            <li key={i} className="space-y-0.5">
              {row.q && <div className="text-muted-foreground">{row.q}</div>}
              <div className="text-foreground font-medium">{row.a}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Collapsible tool-call group (Open Design parity). Collapsed shows a one-line
 * summary of tool names (e.g. "Bash · Read · Edit ×4"); expanded lists each call
 * with its target. Auto-expands while the run streams so progress is visible,
 * then collapses once done. Labels are tool names + symbols only — no
 * translatable strings.
 */
function ToolGroup({
  tools,
  streaming,
}: {
  tools: DesignChatToolCall[];
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || streaming;
  return (
    <div className="border-border/60 overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:bg-accent/50 flex w-full items-center gap-2 px-2 py-1 text-xs"
      >
        <Wrench className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {toolSummary(tools)}
        </span>
        {tools.some((t) => t.status === 'running') && (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        )}
        <ChevronRight
          className={cn('size-3 shrink-0 transition-transform', {
            'rotate-90': expanded,
          })}
        />
      </button>
      {expanded && (
        <ul className="border-border/60 space-y-1 border-t px-2 py-1.5">
          {tools.map((tool) => (
            <li
              key={tool.id}
              className="text-muted-foreground flex items-center gap-2 text-xs"
            >
              <span className="text-foreground/80 shrink-0 font-medium">
                {tool.name}
              </span>
              {tool.detail && (
                <span className="min-w-0 flex-1 truncate font-mono">
                  {tool.detail}
                </span>
              )}
              {tool.status === 'running' ? (
                <Loader2 className="ml-auto size-3 shrink-0 animate-spin" />
              ) : tool.status === 'error' ? (
                <X className="text-destructive ml-auto size-3 shrink-0" />
              ) : tool.status === 'missing' ? (
                <Minus className="text-muted-foreground/60 ml-auto size-3 shrink-0" />
              ) : (
                <Check className="ml-auto size-3 shrink-0 text-emerald-500" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Bash · Read · Edit ×4" — ordered unique tool names with repeat counts. */
function toolSummary(tools: DesignChatToolCall[]): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const tool of tools) {
    if (!counts.has(tool.name)) order.push(tool.name);
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }
  return order
    .map((name) => {
      const n = counts.get(name) ?? 1;
      return n > 1 ? `${name} ×${n}` : name;
    })
    .join(' · ');
}

/** Compact, locale-neutral token/cost/duration summary (symbols, no words). */
function formatUsage(usage: NonNullable<DesignChatTurn['usage']>): string {
  const compact = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
  const parts = [
    `↑ ${compact(usage.inputTokens)}`,
    `↓ ${compact(usage.outputTokens)}`,
  ];
  if (typeof usage.costUsd === 'number' && usage.costUsd > 0) {
    parts.push(`$${usage.costUsd.toFixed(usage.costUsd < 0.01 ? 4 : 2)}`);
  }
  if (typeof usage.durationMs === 'number' && usage.durationMs > 0) {
    parts.push(`${(usage.durationMs / 1000).toFixed(1)}s`);
  }
  return parts.join(' · ');
}
