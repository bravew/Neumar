import { useMemo } from 'react';

import { AnimatePresence, motion } from 'motion/react';

import { DURATION, EASE } from '@/config/animation';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import { AILoadingIndicator } from '../ui/AILoadingIndicator';

/**
 * Format elapsed milliseconds as a human-readable string.
 * e.g. 5000 → "5s", 65000 → "1m 5s", 125000 → "2m 5s"
 */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/**
 * Parse partial planning JSON from the thinking stream to extract
 * goal and step descriptions as they're generated.
 *
 * The thinking content is accumulated raw text like:
 *   ```json\n{"type":"plan","goal":"...","steps":[{"id":"1","description":"..."},
 *
 * We use regex to extract partial data without requiring valid JSON.
 */
function parsePlanPreview(raw: string): {
  goal?: string;
  steps: string[];
} | null {
  if (!raw) return null;

  // Strip markdown code fences
  const stripped = raw.replace(/^```json\s*/m, '').replace(/```\s*$/m, '');
  if (!stripped.includes('"plan"') && !stripped.includes('"goal"')) {
    return null;
  }

  // Extract goal
  const goalMatch = stripped.match(/"goal"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const goal = goalMatch?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, ' ');

  // Extract step descriptions (may be partial — last one could be incomplete)
  const steps: string[] = [];
  const descRegex = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = descRegex.exec(stripped)) !== null) {
    steps.push(match[1].replace(/\\"/g, '"').replace(/\\n/g, ' '));
  }

  // Also try to capture the last, potentially incomplete step description
  const lastPartialMatch = stripped.match(
    /"description"\s*:\s*"((?:[^"\\]|\\.)*)$/,
  );
  if (
    lastPartialMatch &&
    !steps.includes(lastPartialMatch[1].replace(/\\"/g, '"'))
  ) {
    const partial = lastPartialMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, ' ');
    if (partial.length > 0) {
      steps.push(partial + '...');
    }
  }

  if (!goal && steps.length === 0) return null;
  return { goal, steps };
}

interface RunningIndicatorProps {
  messages: AgentMessage[];
  phase?: string;
}

export function RunningIndicator({ messages, phase }: RunningIndicatorProps) {
  const { t } = useLanguage();

  // Find the last tool_use, thinking, or planning_status message
  let lastToolUse: AgentMessage | undefined;
  let thinkingContent: string | undefined;
  let hasThinking = false;
  let planningStatus: AgentMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'tool_use') {
      lastToolUse = messages[i];
      break;
    }
    if (messages[i].type === 'planning_status' && !planningStatus) {
      planningStatus = messages[i];
    }
    if (messages[i].type === 'thinking') {
      hasThinking = true;
      if (!thinkingContent && messages[i].content) {
        thinkingContent = messages[i].content;
      }
    }
  }

  // Parse plan preview from thinking content (only during planning phase)
  const planPreview = useMemo(
    () =>
      phase === 'planning' && thinkingContent
        ? parsePlanPreview(thinkingContent)
        : null,
    [phase, thinkingContent],
  );

  // Formatted elapsed time string from planning_status (if available)
  const elapsedText = useMemo(() => {
    if (!planningStatus?.elapsedMs || planningStatus.elapsedMs <= 0)
      return null;
    return formatElapsed(planningStatus.elapsedMs);
  }, [planningStatus?.elapsedMs]);

  // Map backend planning status content to localized strings
  const localizedPlanningStatus = useMemo(() => {
    const content = planningStatus?.content;
    if (!content) return null;
    const statusMap: Record<string, string> = {
      'Preparing...': t.task.planningPreparing,
      'Analyzing task...': t.task.planningAnalyzing,
      'Reasoning...': t.task.planningReasoning,
      'Thinking deeply...': t.task.planningThinkingDeeply,
    };
    return statusMap[content] ?? t.task.planning;
  }, [planningStatus?.content, t]);

  // Extract the last sentence/phrase from thinking text for a concise subtitle.
  // The backend sends the last ~200 chars of accumulated reasoning. We take
  // the final sentence fragment to avoid showing a wall of text.
  const thinkingSnippet = useMemo(() => {
    const raw = planningStatus?.thinkingText;
    if (!raw) return null;
    // Find the last sentence boundary (., !, ?, newline) and take text after it
    const lastBoundary = Math.max(
      raw.lastIndexOf('. '),
      raw.lastIndexOf('.\n'),
      raw.lastIndexOf('? '),
      raw.lastIndexOf('! '),
      raw.lastIndexOf('\n\n'),
    );
    const snippet =
      lastBoundary > 0 ? raw.slice(lastBoundary + 2).trim() : raw.trim();
    // Cap at ~120 chars for the subtitle
    if (snippet.length > 120) {
      return snippet.slice(0, 117) + '...';
    }
    return snippet || null;
  }, [planningStatus?.thinkingText]);

  // Get description of current activity
  const activityText = (() => {
    // During planning, use the localized "Planning..." with elapsed time.
    // The backend status content (e.g. "Reasoning...") is shown as a subtitle.
    if (phase === 'planning' && (planningStatus || hasThinking)) {
      const base = t.task.planning;
      return elapsedText ? `${base} (${elapsedText})` : base;
    }

    if (!lastToolUse?.name) {
      return hasThinking ? t.task.planning : t.task.thinking;
    }

    const input = lastToolUse.input as Record<string, unknown> | undefined;

    switch (lastToolUse.name) {
      case 'Bash':
        return t.task.runningCommand;
      case 'Read': {
        const readFile = input?.file_path
          ? String(input.file_path).split('/').pop()
          : '';
        return t.task.readingFile.replace('{file}', readFile || 'file');
      }
      case 'Write': {
        const writeFile = input?.file_path
          ? String(input.file_path).split('/').pop()
          : '';
        return t.task.writingFile.replace('{file}', writeFile || 'file');
      }
      case 'Edit': {
        const editFile = input?.file_path
          ? String(input.file_path).split('/').pop()
          : '';
        return t.task.editingFile.replace('{file}', editFile || 'file');
      }
      case 'Grep':
        return t.task.searching;
      case 'Glob':
        return t.task.findingFiles;
      case 'WebSearch':
        return t.task.searchingWeb;
      case 'WebFetch':
        return t.task.fetchingPage;
      case 'Task':
        return t.task.runningSubtask;
      default:
        return t.task.runningTool.replace('{tool}', lastToolUse.name);
    }
  })();

  return (
    <motion.div
      className="flex flex-col gap-1 py-2"
      role="status"
      aria-live="polite"
      aria-label={activityText}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.normal, ease: EASE.out }}
    >
      <AILoadingIndicator size="sm" statusText={activityText} />
      <AnimatePresence>
        {phase === 'planning' &&
          (thinkingSnippet || localizedPlanningStatus) &&
          !planPreview && (
            <motion.p
              className="text-muted-foreground ml-6 max-w-md truncate text-xs opacity-70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast }}
              key="planning-sub"
              title={thinkingSnippet ?? localizedPlanningStatus ?? undefined}
            >
              {thinkingSnippet ?? localizedPlanningStatus}
            </motion.p>
          )}
        {planPreview && (
          <motion.div
            className="text-muted-foreground mt-2 ml-6 space-y-1 text-sm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE.out }}
          >
            {planPreview.goal && (
              <p className="text-foreground/70 text-xs font-medium">
                {planPreview.goal}
              </p>
            )}
            {planPreview.steps.length > 0 && (
              <ol className="text-muted-foreground list-inside list-decimal space-y-0.5 text-xs">
                {planPreview.steps.map((step) => (
                  <li key={step} className="opacity-70">
                    {step}
                  </li>
                ))}
              </ol>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
