import type { TokenUsage } from '@ag-ui/core';

import type { RunTreeNode } from '@/shared/stores/run-tree-store';

export interface RunUsageSummary {
  /** Undefined when the run did not report spend. */
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

function sum(
  entries: TokenUsage[] | undefined,
  pick: (entry: TokenUsage) => number | undefined,
): number | undefined {
  const values = (entries ?? [])
    .map(pick)
    .filter((value): value is number => value !== undefined);
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0)
    : undefined;
}

/**
 * The figures a run row may claim. A run that recorded usage shows exactly what
 * it reported, so an unreported cost is not shown as $0. A run recorded before
 * usage was kept falls back to its stored totals, hidden while they are zero.
 */
export function summarizeRunUsage(node: RunTreeNode): RunUsageSummary {
  if (node.usage) {
    const entries = node.usage.usage;
    return {
      costUsd: node.usage.costUsd,
      tokensIn: sum(entries, (entry) => entry.inputTokens),
      tokensOut: sum(entries, (entry) => entry.outputTokens),
    };
  }
  return {
    costUsd: node.costUsd > 0 ? node.costUsd : undefined,
    tokensIn: node.tokensIn > 0 ? node.tokensIn : undefined,
    tokensOut: node.tokensOut > 0 ? node.tokensOut : undefined,
  };
}
