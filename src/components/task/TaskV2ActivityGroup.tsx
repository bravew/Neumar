import { useMemo, useState } from 'react';

import { AlertTriangle, ChevronRight } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type {
  ActivityEntry,
  AGUIMessage,
  AGUIToolCall,
} from './TaskV2MessageBubble.types';
import { getToolName, shortToolName } from './TaskV2MessageBubble.types';
import { isToolResultError } from './TaskV2ToolCallGroup';
import { PollingLine, ToolCallLine } from './TaskV2ToolCallItems';

/** Tool names listed in the collapsed header before it switches to "+N". */
const HEADER_NAME_LIMIT = 3;

/**
 * Render a narration line with backtick spans as inline code. These are one-
 * or two-sentence progress notes, so full Streamdown (mermaid + shiki) would
 * be a lot of machinery for a muted step label that is collapsed by default.
 */
function StepNote({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/`([^`\n]+)`/g), [text]);
  return (
    <div className="text-muted-foreground/80 px-1 py-1 text-xs leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="bg-muted/60 text-foreground/80 rounded px-1 py-0.5 text-[0.9em]"
          >
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </div>
  );
}

type ToolRun =
  | { type: 'single'; tc: AGUIToolCall }
  | { type: 'polling'; name: string; calls: AGUIToolCall[] };

type RenderRow =
  | { type: 'note'; id: string; text: string }
  | { type: 'tools'; run: ToolRun };

/**
 * Fold consecutive identical tool calls into a single polling row, the same
 * way ToolCallGroup does, while preserving note ordering between them.
 */
function buildRows(entries: ActivityEntry[]): RenderRow[] {
  const rows: RenderRow[] = [];
  for (const entry of entries) {
    if (entry.kind === 'note') {
      rows.push({ type: 'note', id: entry.id, text: entry.text });
      continue;
    }
    const name = getToolName(entry.tc);
    const last = rows[rows.length - 1];
    if (last?.type === 'tools') {
      if (last.run.type === 'polling' && last.run.name === name) {
        last.run.calls.push(entry.tc);
        continue;
      }
      if (last.run.type === 'single' && getToolName(last.run.tc) === name) {
        last.run = { type: 'polling', name, calls: [last.run.tc, entry.tc] };
        continue;
      }
    }
    rows.push({ type: 'tools', run: { type: 'single', tc: entry.tc } });
  }
  return rows;
}

/**
 * One collapsed trace per agent turn.
 *
 * Everything the agent did on the way to its answer — progress narration and
 * tool calls alike — lives behind a single summary line, collapsed by default
 * so the thread reads as question → answer. Expanding reveals the timeline;
 * expanding a tool line inside it reveals args and output. Failures surface as
 * an amber count on the header rather than forcing the group open.
 */
export function ActivityGroup({
  entries,
  allMessages,
  isRunning,
  onCancelTool,
}: {
  entries: ActivityEntry[];
  allMessages: AGUIMessage[];
  /** Thread-level run state — gates the live "Working" header. */
  isRunning?: boolean;
  onCancelTool?: (toolUseId: string) => void;
}) {
  const { t, tt } = useLanguage();

  const toolCalls = useMemo(
    () =>
      entries.flatMap((e) =>
        e.kind === 'tool' ? [e.tc] : [],
      ) as AGUIToolCall[],
    [entries],
  );

  const { errorCount, pendingCount } = useMemo(() => {
    let errors = 0;
    let pending = 0;
    for (const tc of toolCalls) {
      const result = allMessages.find(
        (m) => m.role === 'tool' && m.toolCallId === tc.id,
      );
      if (!result) pending++;
      else if (result.isError || isToolResultError(result.content)) errors++;
    }
    return { errorCount: errors, pendingCount: pending };
  }, [toolCalls, allMessages]);

  // Always starts collapsed, failures included. A turn-wide trace is dozens of
  // steps, and agents routinely hit and recover from errors (a 403, a missing
  // binary, a retry) — auto-expanding on any of them would put the wall of
  // steps right back. The amber count in the header carries the signal; the
  // user opens it if they care. ToolCallGroup keeps its auto-expand because
  // that block is a handful of lines, not a whole turn.
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => buildRows(entries), [entries]);

  const uniqueNames = useMemo(
    () => [...new Set(toolCalls.map((tc) => shortToolName(getToolName(tc))))],
    [toolCalls],
  );
  const nameSummary =
    uniqueNames.length <= HEADER_NAME_LIMIT
      ? uniqueNames.join(', ')
      : `${uniqueNames.slice(0, HEADER_NAME_LIMIT).join(', ')} +${uniqueNames.length - HEADER_NAME_LIMIT}`;

  // "Working" only while the thread is actually streaming AND something in
  // this group has no result yet — a cancelled tool in a finished run must
  // not leave the header spinning forever.
  const live = !!isRunning && pendingCount > 0;
  const summary = live
    ? tt('task.activityWorking', { count: toolCalls.length })
    : tt('task.activityWorked', { count: toolCalls.length });

  return (
    <div className="border-border/40 bg-muted/20 my-2 overflow-hidden rounded-lg border">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="hover:bg-muted/40 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors"
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3.5 shrink-0 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
        {live && (
          <span className="bg-primary size-1.5 shrink-0 animate-pulse rounded-full" />
        )}
        <span className="text-muted-foreground">
          {expanded ? t.task.activityHide : summary}
        </span>
        {!expanded && nameSummary && (
          <span className="text-muted-foreground/60 truncate text-xs">
            · {nameSummary}
          </span>
        )}
        {errorCount > 0 && (
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500"
            title={tt('task.toolGroupFailed', { count: errorCount })}
          >
            <AlertTriangle className="size-3" aria-hidden />
            {tt('task.toolGroupFailed', { count: errorCount })}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-border/30 border-t px-3 py-1.5">
          {rows.map((row) =>
            row.type === 'note' ? (
              <StepNote key={`note-${row.id}`} text={row.text} />
            ) : row.run.type === 'single' ? (
              <ToolCallLine
                key={row.run.tc.id}
                tc={row.run.tc}
                allMessages={allMessages}
                onCancelTool={onCancelTool}
              />
            ) : (
              <PollingLine
                key={`poll-${row.run.calls[0].id}`}
                name={row.run.name}
                calls={row.run.calls}
                allMessages={allMessages}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
