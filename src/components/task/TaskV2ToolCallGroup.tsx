import { useEffect, useMemo, useRef, useState } from 'react';

import { AlertTriangle, ChevronRight } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';
import { getToolName } from './TaskV2MessageBubble.types';
import { AskUserQuestionCard } from './TaskV2MessageBubbleAskUser';
import { PollingLine, ToolCallLine } from './TaskV2ToolCallItems';

/**
 * Heuristic error-detector for tool_result content. The AG-UI TOOL_CALL_RESULT
 * event doesn't currently carry an `isError` field (propagating it would be
 * the cleanest long-term fix), so we inspect the first ~256 chars for the
 * common shapes: `Exit code N≠0`, Python `Traceback`, shell `command not
 * found`, or Claude's own `<tool_use_error>` wrapper. Good enough to flag a
 * failure without false-positives for normal output mentioning "error".
 */
function isToolResultError(content: string | undefined): boolean {
  if (!content) return false;
  const head = content.slice(0, 256);
  return (
    /<tool_use_error>/i.test(head) ||
    /\bexit code\s*[1-9]\d*\b/i.test(head) ||
    /\btraceback \(most recent call last\)/i.test(head) ||
    /\bmodulenotfounderror\b/i.test(head) ||
    /\bcommand not found\b/i.test(head) ||
    /^error:/i.test(head.trim())
  );
}

export function ToolCallGroup({
  toolCalls,
  allMessages,
  onSendMessage,
  onCancelTool,
}: {
  toolCalls: AGUIToolCall[];
  allMessages: AGUIMessage[];
  onSendMessage?: (text: string) => void;
  onCancelTool?: (toolUseId: string) => void;
}) {
  const { t, tt } = useLanguage();

  const errorCount = useMemo(() => {
    let count = 0;
    for (const tc of toolCalls) {
      const result = allMessages.find(
        (m) => m.role === 'tool' && m.toolCallId === tc.id,
      );
      if (result?.isError || isToolResultError(result?.content)) count++;
    }
    return count;
  }, [toolCalls, allMessages]);

  // Default-expanded when anything failed so the user sees why without
  // needing to click — parity with how error bubbles surface in Cursor/
  // Claude Code. Users can still collapse manually.
  const [expanded, setExpanded] = useState(errorCount > 0);
  const userToggledRef = useRef(false);

  // Auto-expand when errors arrive during streaming (errorCount transitions
  // from 0 to >0 after mount). Skip once the user has manually toggled so
  // we don't fight their choice.
  useEffect(() => {
    if (userToggledRef.current) return;
    if (errorCount > 0) setExpanded(true);
  }, [errorCount]);

  // Separate special tool calls (AskUserQuestion) from regular ones
  const specialCalls: AGUIToolCall[] = [];
  const regularCalls: AGUIToolCall[] = [];
  for (const tc of toolCalls) {
    if (getToolName(tc) === 'AskUserQuestion') {
      specialCalls.push(tc);
    } else {
      regularCalls.push(tc);
    }
  }

  // Consolidate consecutive identical tool calls into "runs"
  // e.g., 20x mcp__media_check_video → single progress line
  type ToolRun =
    | { type: 'single'; tc: AGUIToolCall }
    | { type: 'polling'; name: string; calls: AGUIToolCall[] };

  const runs: ToolRun[] = [];
  for (const tc of regularCalls) {
    const name = getToolName(tc);
    const last = runs[runs.length - 1];
    if (last?.type === 'polling' && last.name === name) {
      last.calls.push(tc);
    } else if (last?.type === 'single' && getToolName(last.tc) === name) {
      // Convert single → polling
      runs[runs.length - 1] = { type: 'polling', name, calls: [last.tc, tc] };
    } else {
      runs.push({ type: 'single', tc });
    }
  }

  // Deduplicated count for header
  const deduplicatedCount = runs.length;
  const uniqueNames = [...new Set(regularCalls.map(getToolName))];
  const nameSummary =
    uniqueNames.length <= 3
      ? uniqueNames.join(', ')
      : `${uniqueNames.slice(0, 3).join(', ')} +${uniqueNames.length - 3}`;

  return (
    <>
      {regularCalls.length > 0 && (
        <div className="border-border/40 bg-muted/20 my-2 overflow-hidden rounded-lg border">
          <button
            onClick={() => {
              userToggledRef.current = true;
              setExpanded((v) => !v);
            }}
            className="hover:bg-muted/40 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors"
          >
            <ChevronRight
              className={cn(
                'text-muted-foreground size-3.5 shrink-0 transition-transform duration-200',
                expanded && 'rotate-90',
              )}
            />
            <span className="text-muted-foreground">
              {expanded
                ? t.task.hideSteps
                : t.task.showSteps.replace(
                    '{count}',
                    String(deduplicatedCount),
                  )}
            </span>
            {!expanded && (
              <span className="text-muted-foreground/60 truncate text-xs">
                · {nameSummary}
              </span>
            )}
            {errorCount > 0 && (
              <span
                className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500"
                title={tt('task.toolGroupFailed', { count: errorCount })}
              >
                <AlertTriangle className="size-3" aria-hidden />
                {tt('task.toolGroupFailed', { count: errorCount })}
              </span>
            )}
          </button>
          {expanded && (
            <div className="border-border/30 border-t px-3 py-1.5">
              {runs.map((run) =>
                run.type === 'single' ? (
                  <ToolCallLine
                    key={run.tc.id}
                    tc={run.tc}
                    allMessages={allMessages}
                    onCancelTool={onCancelTool}
                  />
                ) : (
                  <PollingLine
                    key={`poll-${run.calls[0].id}`}
                    name={run.name}
                    calls={run.calls}
                    allMessages={allMessages}
                  />
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Special tool calls (AskUserQuestion) — always shown */}
      {specialCalls.map((tc) => (
        <AskUserQuestionCard
          key={tc.id}
          tc={tc}
          allMessages={allMessages}
          onSendMessage={onSendMessage}
        />
      ))}
    </>
  );
}
