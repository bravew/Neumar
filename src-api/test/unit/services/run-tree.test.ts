import { describe, expect, it } from 'vitest';

import {
  buildRunTree,
  deriveExecutionOutcomes,
  rollupRunTree,
  type RunTreeNode,
} from '@/app/api/runs';

import type { AgentRunRow } from '@/shared/db/operations';

function row(partial: Partial<AgentRunRow> & { id: string }): AgentRunRow {
  return {
    id: partial.id,
    task_id: partial.task_id ?? 'task-1',
    parent_run_id: partial.parent_run_id ?? null,
    provider: partial.provider ?? 'claude',
    status: partial.status ?? 'completed',
    started_at: partial.started_at ?? '2026-01-01 00:00:00',
    finished_at: partial.finished_at ?? '2026-01-01 00:01:00',
    cost_usd: partial.cost_usd ?? 0,
    tokens_in: partial.tokens_in ?? 0,
    tokens_out: partial.tokens_out ?? 0,
    model: partial.model ?? null,
    error: partial.error ?? null,
    completeness: partial.completeness ?? 'unknown',
    delivery: partial.delivery ?? 'not_expected',
    retry: partial.retry ?? 'not_safe',
    failure_cause: partial.failure_cause ?? null,
    runtime_version: partial.runtime_version ?? null,
    attempt: partial.attempt ?? 0,
    session_handle_kind: partial.session_handle_kind ?? null,
    invalidation_reason: partial.invalidation_reason ?? null,
    mode: partial.mode ?? 'task',
    owner_key: partial.owner_key ?? partial.task_id ?? 'task-1',
    project_id: partial.project_id ?? null,
    conversation_id: partial.conversation_id ?? partial.task_id ?? 'task-1',
    client_request_id: partial.client_request_id ?? `request-${partial.id}`,
    request_message_id: partial.request_message_id ?? `message-${partial.id}`,
    execution_id: partial.execution_id ?? partial.id,
    initial_run_id: partial.initial_run_id ?? partial.id,
    source_run_id: partial.source_run_id ?? null,
    run_index: partial.run_index ?? 0,
    recovery_action: partial.recovery_action ?? null,
    delivery_reconciliation_deadline:
      partial.delivery_reconciliation_deadline ?? null,
  };
}

function flatten(roots: RunTreeNode[]): string[] {
  const out: string[] = [];
  function walk(node: RunTreeNode) {
    out.push(node.id);
    for (const child of node.children) walk(child);
  }
  for (const root of roots) walk(root);
  return out;
}

describe('run-tree', () => {
  it('builds a single-root tree with two children', () => {
    const tree = buildRunTree([
      row({ id: 'r' }),
      row({ id: 'a', parent_run_id: 'r' }),
      row({ id: 'b', parent_run_id: 'r' }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('builds nested subagents (root → child → grandchild)', () => {
    const tree = buildRunTree([
      row({ id: 'r' }),
      row({ id: 'a', parent_run_id: 'r' }),
      row({ id: 'aa', parent_run_id: 'a' }),
    ]);
    expect(flatten(tree)).toEqual(['r', 'a', 'aa']);
  });

  it('promotes orphaned rows (missing parent) to roots', () => {
    const tree = buildRunTree([
      row({ id: 'r' }),
      row({ id: 'orphan', parent_run_id: 'gone' }),
    ]);
    const rootIds = tree.map((n) => n.id).sort();
    expect(rootIds).toEqual(['orphan', 'r']);
  });

  it('exposes safe provenance without a raw session handle', () => {
    const [node] = buildRunTree([
      row({
        id: 'run-provenance',
        model: 'claude-opus-5',
        runtime_version: '2.1.220',
        attempt: 1,
        session_handle_kind: 'cli-thread-id',
        invalidation_reason: 'context_rollover',
      }),
    ]);

    expect(node).toMatchObject({
      model: 'claude-opus-5',
      runtimeVersion: '2.1.220',
      attempt: 1,
      sessionHandleKind: 'cli-thread-id',
      invalidationReason: 'context_rollover',
    });
    expect(node).not.toHaveProperty('sessionHandle');
  });

  it('rolls up cost/tokens and counts statuses', () => {
    const rows = [
      row({ id: '1', cost_usd: 0.5, tokens_in: 100, tokens_out: 50 }),
      row({
        id: '2',
        cost_usd: 0.25,
        tokens_in: 30,
        tokens_out: 10,
        status: 'running',
      }),
      row({ id: '3', cost_usd: 0.1, status: 'failed' }),
    ];
    const rollup = rollupRunTree(rows);
    expect(rollup.totalCostUsd).toBeCloseTo(0.85);
    expect(rollup.totalTokensIn).toBe(130);
    expect(rollup.totalTokensOut).toBe(60);
    expect(rollup.runCount).toBe(3);
    expect(rollup.runningCount).toBe(1);
    expect(rollup.failedCount).toBe(1);
  });

  it('aggregates recovery attempts into one successful execution without hiding failures', () => {
    const rows = [
      row({ id: 'initial', status: 'failed', execution_id: 'execution-1' }),
      row({
        id: 'retry',
        status: 'completed',
        execution_id: 'execution-1',
        initial_run_id: 'initial',
        source_run_id: 'initial',
        run_index: 1,
        recovery_action: 'retry',
      }),
    ];

    expect(deriveExecutionOutcomes(rows)).toEqual([
      {
        executionId: 'execution-1',
        initialRunId: 'initial',
        latestRunId: 'retry',
        status: 'succeeded',
        attemptCount: 2,
        recoveryActions: ['retry'],
      },
    ]);
    expect(flatten(buildRunTree(rows))).toEqual(['initial', 'retry']);
  });

  it('reports an unanswered clarification as awaiting input', () => {
    const question = row({
      id: 'question',
      status: 'completed',
      execution_id: 'execution-2',
    });
    expect(
      deriveExecutionOutcomes([question], new Set(['question']))[0]?.status,
    ).toBe('awaiting_input');
    const answer = row({
      id: 'answer',
      execution_id: 'execution-2',
      initial_run_id: 'question',
      source_run_id: 'question',
      run_index: 1,
      recovery_action: 'answer_question',
    });
    expect(
      deriveExecutionOutcomes([question, answer], new Set(['question']))[0]
        ?.status,
    ).toBe('succeeded');
  });

  it('keeps recovery lineage separate from subagent parentage', () => {
    const rows = [
      row({ id: 'initial', status: 'failed', execution_id: 'execution-3' }),
      row({
        id: 'recovery',
        execution_id: 'execution-3',
        initial_run_id: 'initial',
        source_run_id: 'initial',
        run_index: 1,
        recovery_action: 'resume_after_restart',
      }),
      row({
        id: 'subagent',
        parent_run_id: 'recovery',
        source_run_id: 'initial',
        execution_id: 'execution-3',
      }),
    ];

    const [root] = buildRunTree(rows);
    expect(root?.id).toBe('initial');
    expect(root?.children[0]?.id).toBe('recovery');
    expect(root?.children[0]?.children[0]?.id).toBe('subagent');
    expect(deriveExecutionOutcomes(rows)).toHaveLength(1);
  });

  it('collapses repeated restart recovery into one terminal outcome', () => {
    const rows = [
      row({ id: 'initial', status: 'failed', execution_id: 'execution-4' }),
      row({
        id: 'restart-1',
        status: 'failed',
        execution_id: 'execution-4',
        initial_run_id: 'initial',
        source_run_id: 'initial',
        run_index: 1,
        recovery_action: 'resume_after_restart',
      }),
      row({
        id: 'restart-2',
        execution_id: 'execution-4',
        initial_run_id: 'initial',
        source_run_id: 'restart-1',
        run_index: 2,
        recovery_action: 'resume_after_restart',
      }),
    ];

    expect(deriveExecutionOutcomes(rows)).toMatchObject([
      {
        executionId: 'execution-4',
        latestRunId: 'restart-2',
        status: 'succeeded',
        attemptCount: 3,
      },
    ]);
  });
});
