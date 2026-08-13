import { useState } from 'react';

import { ChevronRight } from 'lucide-react';

import { GenUIRenderer } from '@/components/shared/chat-panel';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { parseGenUIEnvelope } from '@/shared/types/gen-ui';

import type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';
import { getToolArgs, getToolName } from './TaskV2MessageBubble.types';

// ── Tool output summary — smart rendering based on content ─────────────────

/** Max chars of output to show inline before truncating */
const OUTPUT_PREVIEW_LENGTH = 400;

function ToolOutputSummary({ content }: { content: string }) {
  const { t } = useLanguage();
  // Try parsing as JSON for structured display
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    // plain text
  }

  const genUI = parseGenUIEnvelope(parsed ?? content);
  if (genUI) return <GenUIRenderer envelope={genUI} />;

  // JSON array of search results — show as link list
  if (Array.isArray(parsed)) {
    const items = parsed.slice(0, 5);
    return (
      <div className="bg-muted/30 space-y-0.5 rounded p-1.5">
        {items.map((item, i) => {
          const title = (item as Record<string, unknown>)?.title as string;
          const url = (item as Record<string, unknown>)?.url as string;
          if (title && url) {
            return (
              <div key={url} className="truncate">
                <span className="text-foreground/70">{title}</span>
                <span className="text-muted-foreground/50 ml-1">
                  {url.replace(/^https?:\/\//, '').slice(0, 40)}
                </span>
              </div>
            );
          }
          return (
            <div
              key={`item-${i}-${JSON.stringify(item).slice(0, 30)}`}
              className="truncate"
            >
              {JSON.stringify(item).slice(0, 80)}
            </div>
          );
        })}
        {parsed.length > 5 && (
          <span className="text-muted-foreground/50">
            {t.task.toolOutputMoreItems.replace(
              '{count}',
              String(parsed.length - 5),
            )}
          </span>
        )}
      </div>
    );
  }

  // JSON object — show key: value pairs
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>).slice(
      0,
      6,
    );
    return (
      <div className="bg-muted/30 space-y-0.5 rounded p-1.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex gap-1.5 truncate">
            <span className="text-muted-foreground/70 shrink-0">{key}:</span>
            <span className="text-foreground/70 truncate">
              {typeof val === 'string'
                ? val.slice(0, 80)
                : JSON.stringify(val).slice(0, 80)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Plain text — show truncated with special handling for common patterns
  const text =
    content.length > OUTPUT_PREVIEW_LENGTH
      ? content.slice(0, OUTPUT_PREVIEW_LENGTH) + '...'
      : content;

  // Strip XML tags (tool_use_error wrappers, etc.)
  const clean = text
    .replace(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/g, '$1')
    .trim();

  if (!clean) return null;

  return (
    <div className="bg-muted/30 max-h-24 overflow-auto rounded p-1.5 whitespace-pre-wrap">
      {clean}
    </div>
  );
}

// ── Compact tool call line with expandable detail ──────────────────────────

/** Humanize a tool name + extract the most informative arg for a 1-line summary. */
export function toolSummary(tc: AGUIToolCall): string {
  const name = getToolName(tc);
  const args = getToolArgs(tc);

  const url = args.url as string | undefined;
  const query = args.query as string | undefined;
  const filePath = (args.file_path ?? args.path ?? args.filePath) as
    | string
    | undefined;
  const command = args.command as string | undefined;
  const toolQuery = args.tool_name as string | undefined; // ToolSearch
  const skillName = args.skill as string | undefined; // Skill tool
  const pattern = args.pattern as string | undefined; // Glob/Grep

  // ToolSearch → show what tool is being looked up
  if (name === 'ToolSearch' && toolQuery) return `ToolSearch(${toolQuery})`;

  // Skill → show skill name
  if (skillName) return `${name}(${skillName})`;

  if (url) {
    try {
      const u = new URL(url);
      return `${name}(${u.hostname}${u.pathname.slice(0, 30)}${u.pathname.length > 30 ? '...' : ''})`;
    } catch {
      return `${name}(${url.slice(0, 40)}...)`;
    }
  }
  if (query)
    return `${name}(${query.slice(0, 50)}${query.length > 50 ? '...' : ''})`;
  if (filePath) {
    const short = filePath.split('/').slice(-2).join('/');
    return `${name}(${short})`;
  }
  if (command)
    return `${name}(${command.slice(0, 40)}${command.length > 40 ? '...' : ''})`;
  if (pattern)
    return `${name}(${pattern.slice(0, 40)}${pattern.length > 40 ? '...' : ''})`;

  // Fallback: show first string arg value
  const firstArg = Object.values(args).find(
    (v) => typeof v === 'string' && v.length > 0,
  ) as string | undefined;
  if (firstArg)
    return `${name}(${firstArg.slice(0, 40)}${firstArg.length > 40 ? '...' : ''})`;

  return name;
}

export function ToolCallLine({
  tc,
  allMessages,
  onCancelTool,
}: {
  tc: AGUIToolCall;
  allMessages: AGUIMessage[];
  onCancelTool?: (toolUseId: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const resultMsg = allMessages.find(
    (m) => m.role === 'tool' && m.toolCallId === tc.id,
  );
  const hasResult = !!resultMsg;
  const stage = tc.toolStage ?? (hasResult ? 'complete' : 'pending');
  const args = getToolArgs(tc);

  return (
    <div className="py-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors"
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            stage === 'complete' && 'bg-emerald-500',
            stage === 'error' && 'bg-destructive',
            stage === 'streaming' && 'bg-blue-500',
            stage === 'pending' && 'bg-amber-500',
          )}
        />
        <span className="truncate">{toolSummary(tc)}</span>
        <ChevronRight
          className={cn(
            'text-muted-foreground/50 ml-auto size-3 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <div className="text-muted-foreground mt-1 ml-4 space-y-1.5 border-l border-dashed pl-3 text-xs">
          {/* Args — as key: value pairs for flat objects, compact JSON otherwise */}
          {Object.keys(args).length > 0 && (
            <div className="space-y-0.5">
              {Object.entries(args).map(([key, val]) => (
                <div key={key} className="flex gap-1.5">
                  <span className="text-muted-foreground/70 shrink-0">
                    {key}:
                  </span>
                  <span className="text-foreground/80 min-w-0 break-all">
                    {typeof val === 'string'
                      ? val.length > 120
                        ? val.slice(0, 120) + '...'
                        : val
                      : JSON.stringify(val)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Output — formatted summary */}
          {resultMsg?.content && (
            <ToolOutputSummary content={resultMsg.content} />
          )}
          {!resultMsg && (
            <span className="flex items-center gap-2">
              <span className="text-amber-500 italic">
                {t.task.toolRunning}
              </span>
              {onCancelTool && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelTool(tc.id);
                  }}
                  className="text-muted-foreground hover:text-destructive cursor-pointer rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-red-50 dark:hover:bg-red-950"
                >
                  {t.task.cancelTool}
                </button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Polling progress line (consolidated repeated tool calls) ──────────────

export function PollingLine({
  name,
  calls,
  allMessages,
}: {
  name: string;
  calls: AGUIToolCall[];
  allMessages: AGUIMessage[];
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const completedCount = calls.filter((tc) =>
    allMessages.some((m) => m.role === 'tool' && m.toolCallId === tc.id),
  ).length;
  const allDone = completedCount === calls.length;
  const isRunning = !allDone;

  // Extract a human-readable short name (strip mcp__ prefix)
  const shortName = name.replace(/^mcp__[^_]+__/, '');

  return (
    <div className="py-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors"
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            allDone ? 'bg-emerald-500' : 'animate-pulse bg-amber-500',
          )}
        />
        <span className="truncate">
          {shortName} ·{' '}
          {t.task.toolPollingChecks.replace('{count}', String(calls.length))}
        </span>
        {isRunning && (
          <span className="text-[10px] text-amber-500">
            {t.task.toolPollingChecking}
          </span>
        )}
        <ChevronRight
          className={cn(
            'text-muted-foreground/50 ml-auto size-3 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
      </button>

      {/* Indeterminate progress bar while polling */}
      {isRunning && (
        <div className="bg-muted/30 relative mx-1 mt-1 h-1 overflow-hidden rounded-full">
          <div
            className="bg-primary/50 absolute h-full w-1/3 rounded-full"
            style={{
              animation: 'indeterminate 1.4s ease-in-out infinite',
            }}
          />
          <style>{`@keyframes indeterminate { 0% { left: -33%; } 100% { left: 100%; } }`}</style>
        </div>
      )}

      {/* Expandable: show individual checks */}
      {open && (
        <div className="text-muted-foreground/60 mt-1 ml-4 max-h-32 space-y-px overflow-auto border-l border-dashed pl-3 text-[10px]">
          {calls.map((tc, i) => {
            const resultMsg = allMessages.find(
              (m) => m.role === 'tool' && m.toolCallId === tc.id,
            );
            const summary = resultMsg?.content
              ? resultMsg.content.slice(0, 60)
              : t.task.toolPending;
            return (
              <div key={tc.id} className="truncate">
                #{i + 1} — {summary}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
