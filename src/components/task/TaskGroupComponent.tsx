import { useEffect, useMemo, useRef, useState } from 'react';

import { CheckCircle2, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';

import {
  AnimatedCollapse,
  DURATION,
  EASE,
  PulsingDot,
  STAGGER,
} from '@/config/animation';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import { PollingToolGroup, ToolExecutionItem } from './tool-execution';
import { humanizeToolName } from './tool-execution/tool-utils';

/** Minimum consecutive same-name tool calls to trigger polling consolidation. */
const POLLING_THRESHOLD = 3;

type ToolWithResult = {
  message: AgentMessage;
  globalIndex: number;
  result?: AgentMessage;
};

/** A run of consecutive tools — either individual or a consolidated polling group. */
type ToolRun =
  | { type: 'single'; tool: ToolWithResult; index: number }
  | { type: 'polling'; toolName: string; tools: ToolWithResult[] };

/**
 * Group consecutive same-name tool calls into runs.
 * Runs of POLLING_THRESHOLD+ become polling groups; shorter runs stay individual.
 */
function groupToolRuns(tools: ToolWithResult[]): ToolRun[] {
  if (tools.length === 0) return [];
  const runs: ToolRun[] = [];
  let runStart = 0;

  for (let i = 1; i <= tools.length; i++) {
    const prevName = tools[i - 1].message.name;
    const curName = i < tools.length ? tools[i].message.name : null;

    if (curName === prevName) continue;

    // End of a run: [runStart, i)
    const runLen = i - runStart;
    if (runLen >= POLLING_THRESHOLD) {
      runs.push({
        type: 'polling',
        toolName: prevName || 'Tool',
        tools: tools.slice(runStart, i),
      });
    } else {
      for (let j = runStart; j < i; j++) {
        runs.push({ type: 'single', tool: tools[j], index: j });
      }
    }
    runStart = i;
  }

  return runs;
}

export function TaskGroupComponent({
  title,
  description,
  tools,
  isCompleted,
  isRunning,
  searchQuery,
}: {
  title: string;
  description: string;
  tools: ToolWithResult[];
  isCompleted: boolean;
  isRunning: boolean;
  searchQuery?: string;
}) {
  const { t } = useLanguage();
  // Default: only expand groups that are not yet completed.
  // Completed groups always start collapsed to keep the conversation clean.
  const [isExpanded, setIsExpanded] = useState(!isCompleted);
  // Track if user manually toggled expansion to prevent auto-collapse from overriding
  const userToggledRef = useRef(false);

  // Auto-collapse when this group completes (only if user hasn't manually toggled)
  useEffect(() => {
    if (isCompleted && !userToggledRef.current) {
      setIsExpanded(false);
    }
  }, [isCompleted]);

  // Elapsed time for running indicator in collapsed header
  const startTimeRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Snapshot captured the moment this group is marked complete — never changes after that
  const [completedElapsedMs, setCompletedElapsedMs] = useState<number | null>(
    null,
  );

  // Live interval — only runs while this specific group is still executing
  useEffect(() => {
    if (isRunning && !isCompleted) {
      if (startTimeRef.current === null) startTimeRef.current = Date.now();
      const id = setInterval(() => {
        setElapsedMs(Date.now() - (startTimeRef.current ?? Date.now()));
      }, 1000);
      return () => clearInterval(id);
    }
    if (!isRunning) {
      // Task ended — reset everything
      startTimeRef.current = null;
      setElapsedMs(0);
      setCompletedElapsedMs(null);
    }
  }, [isRunning, isCompleted]);

  // Freeze elapsed time the moment this group completes
  useEffect(() => {
    if (
      isCompleted &&
      startTimeRef.current !== null &&
      completedElapsedMs === null
    ) {
      setCompletedElapsedMs(Date.now() - startTimeRef.current);
    }
  }, [isCompleted, completedElapsedMs]);

  function formatMs(ms: number): string | null {
    if (ms < 1000) return null;
    return ms < 60_000
      ? `${Math.floor(ms / 1000)}s`
      : `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  }

  const elapsedLabel = formatMs(elapsedMs);
  const completedLabel =
    completedElapsedMs !== null ? formatMs(completedElapsedMs) : null;

  // Group consecutive identical tool calls for consolidated display
  const toolRuns = useMemo(() => groupToolRuns(tools), [tools]);

  // Compact humanized tool-name summary for the collapsed header
  const toolNamesSummary = useMemo(() => {
    const names = [
      ...new Set(tools.map((t) => humanizeToolName(t.message.name || ''))),
    ];
    const preview = names.slice(0, 3).join(', ');
    return names.length > 3 ? `${preview} +${names.length - 3}` : preview;
  }, [tools]);

  return (
    <div className="min-w-0 space-y-3">
      {/* Task description with animated status indicator */}
      {description && (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-start gap-2">
            {isCompleted ? (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: DURATION.normal, ease: EASE.bounce }}
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              </motion.div>
            ) : (
              <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                <PulsingDot color="bg-primary" size="size-2" />
              </div>
            )}
            <span className="text-foreground line-clamp-4 min-w-0 text-sm font-medium break-words">
              {title}
            </span>
          </div>
        </div>
      )}

      {/* Collapsible tool list with animated expand/collapse */}
      {tools.length > 0 && (
        <div className="border-border/40 bg-accent/20 min-w-0 overflow-hidden rounded-xl border">
          {/* Header */}
          <button
            onClick={() => {
              userToggledRef.current = true;
              setIsExpanded(!isExpanded);
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-accent/30 flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-sm transition-colors"
            aria-label={
              isExpanded
                ? t.task.hideSteps
                : t.task.showSteps.replace('{count}', String(tools.length))
            }
          >
            <motion.div
              animate={{ rotate: isExpanded ? 0 : -90 }}
              transition={{ duration: DURATION.fast, ease: EASE.out }}
            >
              <ChevronDown className="size-4 shrink-0" />
            </motion.div>
            <span className="flex-1 text-left">
              {isExpanded ? (
                t.task.hideSteps
              ) : (
                <>
                  {t.task.showSteps.replace('{count}', String(tools.length))}
                  {toolNamesSummary && (
                    <span className="text-muted-foreground/50 ml-1.5 font-sans not-italic">
                      · {toolNamesSummary}
                    </span>
                  )}
                </>
              )}
            </span>
            {/* Running indicator — only for the active (not yet completed) group */}
            {isRunning && !isCompleted && !isExpanded && (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-amber-500">
                <PulsingDot color="bg-amber-500" size="size-1.5" />
                {elapsedLabel ?? t.task.running}
              </span>
            )}
            {/* Completed group — show frozen total duration + checkmark */}
            {isCompleted && !isExpanded && (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-emerald-600/70">
                {completedLabel && <span>{completedLabel}</span>}
                <CheckCircle2 className="size-3 shrink-0" />
              </span>
            )}
          </button>

          {/* Tool list — animated collapse */}
          <AnimatedCollapse isOpen={isExpanded}>
            <div className="px-2 pb-2">
              {toolRuns.map((run) => {
                if (run.type === 'polling') {
                  const firstIdx = run.tools[0].globalIndex;
                  const lastTool = run.tools[run.tools.length - 1];
                  const isLastRunning =
                    lastTool.globalIndex ===
                      tools[tools.length - 1].globalIndex &&
                    isRunning &&
                    !isCompleted;
                  return (
                    <motion.div
                      key={`poll-${firstIdx}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: DURATION.normal,
                        ease: EASE.out,
                      }}
                    >
                      <PollingToolGroup
                        toolName={run.toolName}
                        tools={run.tools}
                        isLastGroupRunning={isLastRunning}
                      />
                    </motion.div>
                  );
                }

                const { tool, index } = run;
                return (
                  <motion.div
                    key={tool.globalIndex}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: DURATION.normal,
                      ease: EASE.out,
                      delay: index * STAGGER.fast,
                    }}
                  >
                    <ToolExecutionItem
                      message={tool.message}
                      result={tool.result}
                      isFirst={index === 0}
                      isLast={
                        tool.globalIndex ===
                          tools[tools.length - 1].globalIndex &&
                        isRunning &&
                        !isCompleted
                      }
                      searchQuery={searchQuery}
                    />
                  </motion.div>
                );
              })}
            </div>
          </AnimatedCollapse>
        </div>
      )}
    </div>
  );
}
