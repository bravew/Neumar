import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  assertRunOwnerExists,
  RunContextError,
} from '@/core/agent/run-context';
import type { RunMode } from '@/core/agent/runtime-state';

import type { AgentRunRow } from '@/shared/db/operations';
import {
  getAgentRun,
  getAgentRunEventsAfter,
  getAgentRunsByOwner,
  getAgentRunsByTaskId,
} from '@/shared/db/operations';
import { getExecutionDiagnostics } from '@/shared/observability/execution-diagnostics';
import { buildSupportBundle } from '@/shared/observability/support-bundle';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RunsRoutes');

export const runsRoutes = new Hono();

export interface RunTreeNode {
  id: string;
  taskId: string;
  parentRunId: string | null;
  provider: string;
  model: string | null;
  status: AgentRunRow['status'];
  startedAt: string;
  finishedAt: string | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  completeness: AgentRunRow['completeness'];
  delivery: AgentRunRow['delivery'];
  retry: AgentRunRow['retry'];
  failureCause: string | null;
  runtimeVersion: string | null;
  attempt: number;
  sessionHandleKind: string | null;
  invalidationReason: string | null;
  mode: RunMode;
  ownerKey: string;
  executionId: string;
  initialRunId: string;
  sourceRunId: string | null;
  runIndex: number | null;
  recoveryAction: AgentRunRow['recovery_action'];
  children: RunTreeNode[];
}

export interface RunTreeRollup {
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  runCount: number;
  runningCount: number;
  failedCount: number;
}

export interface ExecutionOutcomeSummary {
  executionId: string;
  initialRunId: string;
  latestRunId: string;
  status: 'active' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled';
  attemptCount: number;
  recoveryActions: Array<NonNullable<AgentRunRow['recovery_action']>>;
}

const TASK_ID_RE = /^[\w][\w.-]*$/;

function rowToNode(row: AgentRunRow): RunTreeNode {
  return {
    id: row.id,
    taskId: row.task_id,
    parentRunId: row.parent_run_id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    costUsd: row.cost_usd,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    error: row.error,
    completeness: row.completeness,
    delivery: row.delivery,
    retry: row.retry,
    failureCause: row.failure_cause,
    runtimeVersion: row.runtime_version,
    attempt: row.attempt,
    sessionHandleKind: row.session_handle_kind,
    invalidationReason: row.invalidation_reason,
    mode: row.mode,
    ownerKey: row.owner_key,
    executionId: row.execution_id,
    initialRunId: row.initial_run_id,
    sourceRunId: row.source_run_id,
    runIndex: row.run_index,
    recoveryAction: row.recovery_action,
    children: [],
  };
}

/** Orphan rows are promoted to roots; recovery sources form durable lineage. */
export function buildRunTree(rows: AgentRunRow[]): RunTreeNode[] {
  const byId = new Map<string, RunTreeNode>();
  for (const row of rows) byId.set(row.id, rowToNode(row));

  const roots: RunTreeNode[] = [];
  for (const node of byId.values()) {
    const lineageParentId = node.parentRunId ?? node.sourceRunId;
    const parent =
      lineageParentId && lineageParentId !== node.id
        ? byId.get(lineageParentId)
        : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function rollupRunTree(rows: AgentRunRow[]): RunTreeRollup {
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let runningCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    totalCostUsd += row.cost_usd;
    totalTokensIn += row.tokens_in;
    totalTokensOut += row.tokens_out;
    if (row.status === 'running') runningCount += 1;
    if (row.status === 'failed') failedCount += 1;
  }
  return {
    totalCostUsd,
    totalTokensIn,
    totalTokensOut,
    runCount: rows.length,
    runningCount,
    failedCount,
  };
}

export function deriveExecutionOutcomes(
  rows: readonly AgentRunRow[],
  questionRunIds: ReadonlySet<string> = new Set(),
): ExecutionOutcomeSummary[] {
  const groups = new Map<string, AgentRunRow[]>();
  for (const row of rows) {
    if (row.parent_run_id) continue;
    const group = groups.get(row.execution_id) ?? [];
    group.push(row);
    groups.set(row.execution_id, group);
  }
  return [...groups.values()].map((group) => {
    const ordered = [...group].sort(
      (left, right) =>
        (left.run_index ?? 0) - (right.run_index ?? 0) ||
        left.started_at.localeCompare(right.started_at),
    );
    const latest = ordered.at(-1)!;
    let lastQuestionIndex = -1;
    let lastAnswerIndex = -1;
    ordered.forEach((row, index) => {
      if (questionRunIds.has(row.id)) lastQuestionIndex = index;
      if (row.recovery_action === 'answer_question') lastAnswerIndex = index;
    });
    const awaitingInput = lastQuestionIndex > lastAnswerIndex;
    const status: ExecutionOutcomeSummary['status'] = ordered.some(
      (row) => row.status === 'running',
    )
      ? 'active'
      : awaitingInput
        ? 'awaiting_input'
        : latest.status === 'completed'
          ? 'succeeded'
          : latest.status === 'cancelled'
            ? 'cancelled'
            : 'failed';
    return {
      executionId: latest.execution_id,
      initialRunId: latest.initial_run_id,
      latestRunId: latest.id,
      status,
      attemptCount: ordered.length,
      recoveryActions: ordered
        .map((row) => row.recovery_action)
        .filter(
          (action): action is NonNullable<AgentRunRow['recovery_action']> =>
            action !== null,
        ),
    };
  });
}

export function questionRunIds(rows: readonly AgentRunRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const asked = getAgentRunEventsAfter(row.id, -1).some((event) => {
      if (event.event_type !== 'TOOL_CALL_START') return false;
      try {
        const value = JSON.parse(event.event_json) as {
          toolCallName?: unknown;
        };
        return value.toolCallName === 'AskUserQuestion';
      } catch {
        return false;
      }
    });
    if (asked) ids.add(row.id);
  }
  return ids;
}

function runTreeResponse(rows: AgentRunRow[]) {
  return {
    tree: buildRunTree(rows),
    rollup: rollupRunTree(rows),
    executions: deriveExecutionOutcomes(rows, questionRunIds(rows)),
  };
}

const RUN_ID_RE = /^[\w][\w.-]*$/;
const RUN_MODES = new Set<RunMode>(['task', 'design', 'video']);

runsRoutes.post('/:runId/support-bundle', async (c) => {
  const runId = c.req.param('runId');
  if (!RUN_ID_RE.test(runId)) {
    return c.json({ error: 'Invalid runId' }, 400 as ContentfulStatusCode);
  }
  let requested: { mode?: unknown; ownerKey?: unknown };
  try {
    requested = (await c.req.json()) as typeof requested;
  } catch {
    return c.json(
      { error: 'Invalid request body' },
      400 as ContentfulStatusCode,
    );
  }
  const mode = requested.mode as RunMode;
  const ownerKey = requested.ownerKey;
  if (
    !RUN_MODES.has(mode) ||
    typeof ownerKey !== 'string' ||
    !RUN_ID_RE.test(ownerKey)
  ) {
    return c.json({ error: 'Invalid run owner' }, 400 as ContentfulStatusCode);
  }
  try {
    const run = getAgentRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404 as ContentfulStatusCode);
    }
    if (run.mode !== mode || run.owner_key !== ownerKey) {
      return c.json(
        { error: 'Run owner mismatch' },
        409 as ContentfulStatusCode,
      );
    }
    await assertRunOwnerExists(mode, ownerKey);
    const bundle = await buildSupportBundle({ runId, mode, ownerKey });
    return new Response(new Uint8Array(bundle.data), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${bundle.filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof RunContextError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    logger.error('Failed to build support bundle:', err);
    return c.json(
      { error: 'Failed to build support bundle' },
      500 as ContentfulStatusCode,
    );
  }
});

runsRoutes.get('/:runId/diagnostics', async (c) => {
  const runId = c.req.param('runId');
  if (!RUN_ID_RE.test(runId)) {
    return c.json({ error: 'Invalid runId' }, 400 as ContentfulStatusCode);
  }
  try {
    const diagnostics = getExecutionDiagnostics(runId);
    if (!diagnostics) {
      return c.json({ error: 'Run not found' }, 404 as ContentfulStatusCode);
    }
    await assertRunOwnerExists(diagnostics.mode, diagnostics.ownerKey);
    return c.json(diagnostics);
  } catch (err) {
    if (err instanceof RunContextError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    logger.error('Failed to build run diagnostics:', err);
    return c.json(
      { error: 'Failed to build run diagnostics' },
      500 as ContentfulStatusCode,
    );
  }
});

runsRoutes.get('/owner/:mode/:ownerKey/tree', async (c) => {
  const mode = c.req.param('mode') as RunMode;
  const ownerKey = c.req.param('ownerKey');
  if (!RUN_MODES.has(mode) || !RUN_ID_RE.test(ownerKey)) {
    return c.json({ error: 'Invalid run owner' }, 400 as ContentfulStatusCode);
  }
  try {
    await assertRunOwnerExists(mode, ownerKey);
    return c.json(runTreeResponse(getAgentRunsByOwner(mode, ownerKey)));
  } catch (err) {
    if (err instanceof RunContextError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    logger.error('Failed to build owner run tree:', err);
    return c.json(
      { error: 'Failed to build run tree' },
      500 as ContentfulStatusCode,
    );
  }
});

runsRoutes.get('/:taskId/tree', (c) => {
  const taskId = c.req.param('taskId');
  if (!TASK_ID_RE.test(taskId)) {
    return c.json({ error: 'Invalid taskId' }, 400 as ContentfulStatusCode);
  }
  try {
    const rows = getAgentRunsByTaskId(taskId);
    return c.json(runTreeResponse(rows));
  } catch (err) {
    logger.error('Failed to build run tree:', err);
    return c.json(
      { error: 'Failed to build run tree' },
      500 as ContentfulStatusCode,
    );
  }
});
