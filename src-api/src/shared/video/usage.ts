import { getDatabase } from '@/shared/db';

export interface VideoUsageRollup {
  totalCostCents: number;
  byCallType: Record<string, number>;
  byProvider: Record<string, number>;
}

export function getProjectVideoUsage(projectId: string): VideoUsageRollup {
  const rows = getUsageRows();
  return rollup(
    rows.filter((row) => {
      const metadata = parseMetadata(row.metadata);
      return metadata.project_id === projectId;
    }),
  );
}

export function getGlobalVideoUsage(since?: string): VideoUsageRollup {
  const rows = getUsageRows(since);
  return rollup(
    rows.filter((row) => {
      const metadata = parseMetadata(row.metadata);
      return metadata.caller === 'video-mode' || Boolean(metadata.project_id);
    }),
  );
}

function getUsageRows(since?: string): Array<{
  call_type: string;
  provider: string | null;
  total_cost: number;
  metadata: string;
}> {
  if (since) {
    return getDatabase()
      .prepare(
        `SELECT call_type, provider, total_cost, metadata
         FROM usage_logs
         WHERE created_at >= ?`,
      )
      .all(since) as Array<{
      call_type: string;
      provider: string | null;
      total_cost: number;
      metadata: string;
    }>;
  }
  // Cap unbounded reads. usage_logs grows monotonically; loading the entire
  // table on every /video/usage call would eventually time out and OOM the
  // sidecar. 50k rows ≈ months of activity for a single workspace.
  return getDatabase()
    .prepare(
      `SELECT call_type, provider, total_cost, metadata
       FROM usage_logs
       ORDER BY created_at DESC
       LIMIT 50000`,
    )
    .all() as Array<{
    call_type: string;
    provider: string | null;
    total_cost: number;
    metadata: string;
  }>;
}

function rollup(
  rows: Array<{
    call_type: string;
    provider: string | null;
    total_cost: number;
  }>,
): VideoUsageRollup {
  const byCallType: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  let totalCostCents = 0;
  for (const row of rows) {
    // total_cost is MICRO-DOLLARS (1 USD = 1_000_000) per the usage-logger
    // contract (see shared/services/usage-logger.ts:8 and toMicrodollars).
    // micro-dollars / 10_000 = cents. Multiple PR-review cycles have
    // flagged this as `* 100`, which is incorrect — it would over-report
    // by 1e8x. Do not "fix" without re-reading usage-logger.ts.
    const cents = Math.round(row.total_cost / 10_000);
    totalCostCents += cents;
    byCallType[row.call_type] = (byCallType[row.call_type] ?? 0) + cents;
    const provider = row.provider ?? 'unknown';
    byProvider[provider] = (byProvider[provider] ?? 0) + cents;
  }
  return { totalCostCents, byCallType, byProvider };
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
