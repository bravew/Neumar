import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Check,
  Copy,
  DollarSign,
  GitBranch,
  Play,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const COPY_FEEDBACK_DURATION = 2000;

interface MessageToolbarProps {
  content: string;
  cost?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  onRetry?: () => void;
  onResume?: () => void;
  onFork?: () => void;
}

type FeedbackState = 'none' | 'up' | 'down';

export function MessageToolbar({
  content,
  cost,
  usage,
  onRetry,
  onResume,
  onFork,
}: MessageToolbarProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>('none');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Cleanup copy feedback timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_DURATION,
      );
    } catch {
      // Clipboard API not available
    }
  }, [content]);

  const handleFeedback = useCallback((type: 'up' | 'down') => {
    setFeedback((prev) => (prev === type ? 'none' : type));
  }, []);

  const hasCostData =
    cost != null ||
    (usage &&
      (usage.input_tokens != null ||
        usage.output_tokens != null ||
        usage.cache_read_input_tokens != null ||
        usage.cache_creation_input_tokens != null));

  return (
    <TooltipProvider delayDuration={0}>
      <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Thumbs up */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => handleFeedback('up')}
              className={cn(
                'hover:text-foreground cursor-pointer rounded-md p-1.5 font-medium transition-colors',
                feedback === 'up' && 'text-foreground bg-muted',
              )}
              aria-label={t.task.thumbsUp}
            >
              <ThumbsUp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.task.thumbsUp}</TooltipContent>
        </Tooltip>

        {/* Thumbs down */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => handleFeedback('down')}
              className={cn(
                'hover:text-foreground cursor-pointer rounded-md p-1.5 font-medium transition-colors',
                feedback === 'down' && 'text-foreground bg-muted',
              )}
              aria-label={t.task.thumbsDown}
            >
              <ThumbsDown className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.task.thumbsDown}</TooltipContent>
        </Tooltip>

        {/* Retry */}
        {onRetry && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRetry}
                className="hover:text-foreground cursor-pointer rounded-md p-1.5 font-medium transition-colors"
                aria-label={t.task.retry}
              >
                <RefreshCw className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.task.retry}</TooltipContent>
          </Tooltip>
        )}

        {/* Continue */}
        {onResume && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onResume}
                className="hover:text-foreground cursor-pointer rounded-md p-1.5 font-medium transition-colors"
                aria-label={t.task.continueRun}
              >
                <Play className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.task.continueRun}</TooltipContent>
          </Tooltip>
        )}

        {/* Fork */}
        {onFork && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onFork}
                className="hover:text-foreground cursor-pointer rounded-md p-1.5 font-medium transition-colors"
                aria-label={t.task.forkFromHere}
              >
                <GitBranch className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.task.forkFromHere}</TooltipContent>
          </Tooltip>
        )}

        {/* Copy */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopy}
              className="hover:text-foreground cursor-pointer rounded-md p-1.5 font-medium transition-colors"
              aria-label={copied ? t.task.copied : t.task.copyMessage}
            >
              {copied ? (
                <Check className="size-3.5 text-green-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {copied ? t.task.copied : t.task.copyMessage}
          </TooltipContent>
        </Tooltip>

        {/* Cost breakdown tooltip */}
        {hasCostData && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="hover:text-foreground cursor-pointer rounded-md p-1.5 font-medium transition-colors"
                aria-label={t.task.costBreakdown}
              >
                <DollarSign className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="w-52 p-0">
              <div className="space-y-1 p-2 text-xs">
                <div className="mb-1.5 font-medium">{t.task.costBreakdown}</div>
                {cost != null && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.task.totalCost}</span>
                    <span className="font-mono">${cost.toFixed(4)}</span>
                  </div>
                )}
                {usage?.input_tokens != null && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.task.inputTokens}</span>
                    <span className="font-mono">
                      {usage.input_tokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {usage?.output_tokens != null && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.task.outputTokens}</span>
                    <span className="font-mono">
                      {usage.output_tokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {usage?.cache_read_input_tokens != null && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {t.task.cacheReadTokens}
                    </span>
                    <span className="font-mono">
                      {usage.cache_read_input_tokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {usage?.cache_creation_input_tokens != null && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {t.task.cacheCreationTokens}
                    </span>
                    <span className="font-mono">
                      {usage.cache_creation_input_tokens.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
