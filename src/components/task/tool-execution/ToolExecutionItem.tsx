import { memo, useState } from 'react';

import { AnimatePresence, motion } from 'motion/react';

import { DURATION, EASE } from '@/config/animation';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  getFullParamString,
  getFileWriteContent,
  getFileWritePath,
  getMcpServerName,
  getResultInfo,
  getTruncatedParam,
  isFileWriteTool,
  maskSecrets,
  statusAwareToolLabel,
} from './tool-utils';
import { ToolDetailModal } from './ToolDetailModal';

export interface ToolExecutionItemProps {
  message: AgentMessage;
  result?: AgentMessage;
  isLast: boolean;
  isFirst?: boolean;
  searchQuery?: string;
}

/**
 * Memoized tool execution item — prevents unnecessary re-renders
 * when sibling messages update in the task execution list.
 */
export const ToolExecutionItem = memo(function ToolExecutionItem({
  message,
  result,
  isLast,
}: ToolExecutionItemProps) {
  const { t } = useLanguage();
  const [showModal, setShowModal] = useState(false);

  const rawName = message.name || '';
  const input = message.input as Record<string, unknown> | undefined;
  const fullParam = maskSecrets(getFullParamString(rawName, input));
  const truncatedParam = getTruncatedParam(fullParam);

  // Check status
  const isRunning = isLast && !result;
  const hasError = !!result?.isError;
  const { summary, isWarning } = getResultInfo(rawName, result, t);
  const isActualError = hasError && !isWarning;
  const isCompleted = !isRunning && !isActualError && result;

  // Tense-aware display label + MCP server badge
  const status = isRunning ? 'running' : isActualError ? 'error' : 'done';
  const displayLabel = statusAwareToolLabel(rawName, status);
  const mcpServer = getMcpServerName(rawName);
  const writePath = isFileWriteTool(rawName) ? getFileWritePath(input) : '';
  const writeContent = isFileWriteTool(rawName)
    ? getFileWriteContent(input)
    : '';
  const writeLineCount = writeContent
    ? writeContent.split('\n').length
    : undefined;
  const writeByteCount = writeContent
    ? new TextEncoder().encode(writeContent).byteLength
    : undefined;

  const handleClick = () => {
    if (!isRunning) {
      setShowModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          '-mx-1 w-full rounded-md px-1 py-1.5 text-left font-mono text-[13px] transition-colors',
          !isRunning && 'hover:bg-accent/50 cursor-pointer',
        )}
        onClick={handleClick}
        disabled={isRunning}
      >
        {/* Line 1: bullet + tool name + params */}
        <div className="flex items-start gap-2">
          {/* Bullet indicator — animated status dot */}
          <motion.span
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              isRunning
                ? 'bg-amber-500'
                : isActualError
                  ? 'bg-red-500'
                  : isWarning
                    ? 'bg-amber-500'
                    : isCompleted
                      ? 'bg-emerald-500'
                      : 'bg-muted-foreground',
            )}
            animate={
              isRunning
                ? {
                    scale: [1, 1.3, 1],
                    opacity: [1, 0.6, 1],
                  }
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

          {/* Tool call text */}
          <div className="min-w-0 flex-1">
            <p className="leading-relaxed">
              <span className="text-foreground font-semibold">
                {displayLabel}
              </span>
              {mcpServer && (
                <span className="text-muted-foreground/60 ml-1 text-xs">
                  · {mcpServer}
                </span>
              )}
              {fullParam && (
                <>
                  <span className="text-muted-foreground">(</span>
                  <span className="text-muted-foreground">
                    {truncatedParam}
                  </span>
                  <span className="text-muted-foreground">)</span>
                </>
              )}
            </p>
          </div>
        </div>

        {writePath && (
          <div className="border-border bg-muted/30 mt-2 ml-4 rounded-md border px-3 py-2 font-sans">
            <div className="text-foreground truncate text-xs font-medium">
              {t.task.toolWriteCardTitle}
            </div>
            <div className="text-muted-foreground mt-1 min-w-0 space-y-0.5 text-xs">
              <p className="truncate">
                {t.task.toolWriteCardPath.replace(
                  '{path}',
                  maskSecrets(writePath),
                )}
              </p>
              {(writeLineCount !== undefined ||
                writeByteCount !== undefined) && (
                <p>
                  {writeLineCount !== undefined
                    ? t.task.toolWriteCardLines.replace(
                        '{count}',
                        String(writeLineCount),
                      )
                    : ''}
                  {writeLineCount !== undefined && writeByteCount !== undefined
                    ? ' · '
                    : ''}
                  {writeByteCount !== undefined
                    ? t.task.toolWriteCardBytes.replace(
                        '{count}',
                        String(writeByteCount),
                      )
                    : ''}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Line 2: Result summary */}
        <div className="mt-0.5 ml-1 flex items-start gap-2">
          <span className="text-muted-foreground/40 leading-none">└</span>
          <span
            className={cn(
              isActualError
                ? 'text-red-500'
                : isWarning
                  ? 'text-amber-500'
                  : 'text-muted-foreground',
            )}
          >
            {summary}
          </span>
        </div>
      </button>

      {/* Modal — animated enter/exit */}
      <AnimatePresence>
        {showModal && (
          <ToolDetailModal
            toolName={rawName}
            input={input}
            output={result?.output || result?.content}
            isError={isActualError}
            isWarning={isWarning}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
});
