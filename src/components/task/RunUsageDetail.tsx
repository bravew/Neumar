import type { TokenUsage } from '@ag-ui/core';

import { useLanguage } from '@/shared/providers/language-provider';
import type { RunTreeNode, RunStatus } from '@/shared/stores/run-tree-store';

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function breakdown(
  entry: TokenUsage,
  t: ReturnType<typeof useLanguage>['t']['task'],
): string {
  const parts: string[] = [];
  if (entry.inputTokens !== undefined || entry.outputTokens !== undefined) {
    parts.push(
      `${formatCount(entry.inputTokens ?? 0)}↑ ${formatCount(entry.outputTokens ?? 0)}↓`,
    );
  }
  if (entry.cachedInputTokens !== undefined) {
    parts.push(
      t.runUsageCached.replace('{count}', formatCount(entry.cachedInputTokens)),
    );
  }
  if (entry.cacheWriteInputTokens !== undefined) {
    parts.push(
      t.runUsageCacheWrite.replace(
        '{count}',
        formatCount(entry.cacheWriteInputTokens),
      ),
    );
  }
  if (entry.reasoningTokens !== undefined) {
    parts.push(
      t.runUsageReasoning.replace(
        '{count}',
        formatCount(entry.reasoningTokens),
      ),
    );
  }
  return parts.join(' · ');
}

/** The run's terminal state and what it reported, one line per provider/model. */
export function RunUsageDetail({
  node,
  paddingLeft,
}: {
  node: RunTreeNode;
  paddingLeft: number;
}) {
  const { t } = useLanguage();
  const statusLabel: Record<RunStatus, string> = {
    running: t.task.runStatusRunning,
    completed: t.task.runStatusCompleted,
    failed: t.task.runStatusFailed,
    cancelled: t.task.runStatusCancelled,
  };
  const entries = node.usage?.usage ?? [];
  return (
    <div
      className="text-muted-foreground mt-0.5 space-y-0.5 text-xs"
      style={{ paddingLeft }}
    >
      <div>{statusLabel[node.status]}</div>
      {entries.map((entry, index) => (
        <div key={`${entry.provider ?? ''}:${entry.model ?? ''}:${index}`}>
          {[entry.model ?? entry.provider, breakdown(entry, t.task)]
            .filter(Boolean)
            .join(' · ')}
        </div>
      ))}
      {!node.usage && node.status !== 'running' && (
        <div>{t.task.runUsageNotReported}</div>
      )}
    </div>
  );
}
