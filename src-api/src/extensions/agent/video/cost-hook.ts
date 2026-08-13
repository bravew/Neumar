import type Database from 'better-sqlite3';

import type { ToolLifecycleHook } from '@/core/agent/tool-lifecycle-hooks';

import { getDatabase } from '@/shared/db';
import { getSessionContext } from '@/shared/services/session-context';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('VideoCostTelemetry');
const COST_KEY_RE = /^(cost|costUsd|cost_usd|totalCostUsd|estimatedCostUsd)$/i;

export const videoCostTelemetryHook: ToolLifecycleHook = {
  event: 'post_tool_use',
  matcher: '^(mcp__(video-edit|media)__|video_|media_)',
  priority: 0,
  async: true,
  handler: async ({ toolName, toolResult, sessionId }) => {
    const costUsd = extractCostUsd(toolResult);
    if (costUsd <= 0) return { action: 'allow' };

    const context = getSessionContext();
    if (!context?.videoProjectId) return { action: 'allow' };

    const resolvedSessionId = context.sessionId ?? sessionId;
    if (!resolvedSessionId) return { action: 'allow' };

    try {
      accumulateVideoSessionCost(
        context.videoProjectId,
        resolvedSessionId,
        costUsd,
      );
    } catch (error) {
      logger.warn(
        `Failed to record ${toolName} cost: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { action: 'allow' };
  },
};

export function accumulateVideoSessionCost(
  projectId: string,
  sessionId: string,
  costUsd: number,
  db: Database.Database = getDatabase(),
): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO video_session_cost (
        project_id,
        session_id,
        cost_usd,
        updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, session_id) DO UPDATE SET
        cost_usd = video_session_cost.cost_usd + excluded.cost_usd,
        updated_at = excluded.updated_at
    `,
  ).run(projectId, sessionId, costUsd, now);
}

export function extractCostUsd(value: unknown): number {
  const parsed = parseToolResult(value);
  return firstCostNumber(parsed) ?? 0;
}

function parseToolResult(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return value;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== 'string') continue;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      continue;
    }
  }
  return value;
}

function firstCostNumber(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const cost = firstCostNumber(item);
      if (cost !== undefined) return cost;
    }
    return undefined;
  }

  for (const [key, item] of Object.entries(value)) {
    if (COST_KEY_RE.test(key) && typeof item === 'number') {
      return Number.isFinite(item) && item > 0 ? item : undefined;
    }
    const nested = firstCostNumber(item);
    if (nested !== undefined) return nested;
  }
  return undefined;
}
