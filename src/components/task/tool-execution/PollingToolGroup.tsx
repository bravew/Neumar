import { memo, useState } from 'react';

import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { DURATION, EASE } from '@/config/animation';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { getResultInfo } from './tool-utils';
import { ToolDetailModal } from './ToolDetailModal';

interface PollingToolGroupProps {
  toolName: string;
  tools: {
    message: AgentMessage;
    globalIndex: number;
    result?: AgentMessage;
  }[];
  isLastGroupRunning: boolean;
}

/**
 * Consolidated display for repeated identical tool calls (e.g., status polling).
 * Shows a single item with check count and pulse progress bar instead of
 * listing each individual call.
 */
export const PollingToolGroup = memo(function PollingToolGroup({
  toolName,
  tools,
  isLastGroupRunning,
}: PollingToolGroupProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalToolIndex, setModalToolIndex] = useState(0);

  const lastTool = tools[tools.length - 1];
  const lastResult = lastTool.result;
  const isRunning = isLastGroupRunning && !lastResult;
  const totalCount = tools.length;

  // Get the latest result summary
  const { isWarning } = getResultInfo(toolName, lastResult, t);

  const hasError = !!lastResult?.isError;
  const isActualError = hasError && !isWarning;
  const isCompleted = !isRunning && !isActualError && lastResult;

  return (
    <>
      <div className="-mx-1 rounded-md px-1 py-1.5 font-mono text-[13px]">
        {/* Main consolidated line */}
        <div className="flex items-start gap-2">
          {/* Status dot */}
          <motion.span
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              isRunning
                ? 'bg-amber-500'
                : isActualError
                  ? 'bg-red-500'
                  : isCompleted
                    ? 'bg-emerald-500'
                    : 'bg-muted-foreground',
            )}
            animate={
              isRunning
                ? { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }
                : isCompleted
                  ? { scale: [0.8, 1.15, 1] }
                  : { scale: 1 }
            }
            transition={
              isRunning
                ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                : { duration: DURATION.normal, ease: EASE.bounce }
            }
          />

          <div className="min-w-0 flex-1">
            <p className="leading-relaxed">
              <span className="text-foreground font-semibold">{toolName}</span>
              <span className="text-muted-foreground ml-2 text-xs">
                {t.task.toolPollingChecks.replace(
                  '{count}',
                  String(totalCount),
                )}
              </span>
            </p>
          </div>
        </div>

        {/* Indeterminate progress bar — only visible while running */}
        {isRunning && (
          <div className="mt-1.5 ml-4 flex items-center gap-2">
            <div className="bg-muted relative h-1 flex-1 overflow-hidden rounded-full">
              <motion.div
                className="absolute inset-y-0 w-1/3 rounded-full bg-amber-500"
                animate={{ left: ['-33%', '100%'] }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            </div>
            <span className="text-muted-foreground shrink-0 text-[11px]">
              {t.task.toolPollingChecking}
            </span>
          </div>
        )}

        {/* Latest result summary */}
        {lastResult && (
          <div className="mt-0.5 ml-1 flex items-start gap-2">
            <span className="text-muted-foreground/40 leading-none">
              &hairsp;
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-[11px] transition-colors"
              onClick={() => setExpanded(!expanded)}
            >
              <motion.div
                animate={{ rotate: expanded ? 0 : -90 }}
                transition={{ duration: DURATION.fast, ease: EASE.out }}
              >
                <ChevronDown className="size-3" />
              </motion.div>
              {expanded
                ? t.task.hideSteps
                : t.task.showSteps.replace('{count}', String(totalCount))}
            </button>
          </div>
        )}

        {/* Expandable individual checks */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-1 ml-4 space-y-0.5">
                {tools.map(({ result: toolResult, globalIndex }, i) => {
                  const { summary } = getResultInfo(toolName, toolResult, t);
                  const isItemRunning =
                    isLastGroupRunning && !toolResult && i === tools.length - 1;
                  return (
                    <button
                      key={globalIndex}
                      type="button"
                      className={cn(
                        'text-muted-foreground flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px]',
                        !isItemRunning && 'hover:bg-accent/50 cursor-pointer',
                      )}
                      disabled={isItemRunning}
                      onClick={() => {
                        setModalToolIndex(i);
                        setShowModal(true);
                      }}
                    >
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          isItemRunning
                            ? 'bg-amber-500'
                            : toolResult?.isError
                              ? 'bg-red-500'
                              : 'bg-emerald-500',
                        )}
                      />
                      <span>
                        #{i + 1} &mdash; {summary}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Detail modal for individual check */}
      <AnimatePresence>
        {showModal && tools[modalToolIndex] && (
          <ToolDetailModal
            toolName={toolName}
            input={
              tools[modalToolIndex].message.input as
                | Record<string, unknown>
                | undefined
            }
            output={
              tools[modalToolIndex].result?.output ||
              tools[modalToolIndex].result?.content
            }
            isError={!!tools[modalToolIndex].result?.isError}
            isWarning={false}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
});
