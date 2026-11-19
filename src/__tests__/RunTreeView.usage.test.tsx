import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunTreeView } from '@/components/task/RunTreeView';
import {
  useRunTreeStore,
  type RunTreeNode,
} from '@/shared/stores/run-tree-store';

import { renderWithProviders } from './helpers/render-with-providers';

// The diagnostics panel fetches its own data; this suite is about usage.
vi.mock(
  '@/components/shared/run-diagnostics/ExecutionDiagnosticsPanel',
  () => ({
    ExecutionDiagnosticsPanel: () => null,
  }),
);

function node(partial: Partial<RunTreeNode> & { id: string }): RunTreeNode {
  return {
    taskId: 'task-1',
    parentRunId: null,
    provider: 'claude',
    model: null,
    status: 'completed',
    startedAt: '2026-11-17T00:00:00Z',
    finishedAt: '2026-11-17T00:01:00Z',
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    usage: null,
    error: null,
    completeness: 'complete',
    delivery: 'not_expected',
    retry: 'not_safe',
    failureCause: null,
    runtimeVersion: null,
    attempt: 0,
    sessionHandleKind: null,
    invalidationReason: null,
    mode: 'task',
    ownerKey: 'task-1',
    executionId: partial.id,
    initialRunId: partial.id,
    sourceRunId: null,
    runIndex: 0,
    recoveryAction: null,
    children: [],
    ...partial,
  };
}

function seed(nodes: RunTreeNode[]) {
  useRunTreeStore.setState({
    byTaskId: {
      'task-1': {
        tree: nodes,
        rollup: {
          totalCostUsd: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          runCount: nodes.length,
          runningCount: 0,
          failedCount: 0,
        },
        executions: [],
        // Fresh enough that the view's own fetch is skipped.
        fetchedAt: Date.now() + 60_000,
        loading: false,
        error: null,
      },
    },
    byOwner: {},
  });
}

function rowFor(label: RegExp) {
  return screen.getByRole('button', { name: label });
}

beforeEach(() => {
  useRunTreeStore.setState({ byTaskId: {}, byOwner: {} });
});

describe('RunTreeView usage claims', () => {
  it('shows a reported zero cost, but nothing for a run that reported none', () => {
    seed([
      node({
        id: 'reported',
        provider: 'codex',
        usage: {
          costUsd: 0,
          usage: [{ inputTokens: 10, outputTokens: 5 }],
        },
      }),
      node({ id: 'silent', provider: 'cursor' }),
    ]);
    renderWithProviders(<RunTreeView taskId="task-1" />);
    expect(rowFor(/codex run/).textContent).toContain('$0');
    expect(rowFor(/codex run/).textContent).toContain('10↑');
    expect(rowFor(/cursor run/).textContent).not.toContain('$');
    expect(rowFor(/cursor run/).textContent).not.toContain('↑');
  });

  it('keeps the partial spend and terminal state of a failed run', () => {
    seed([
      node({
        id: 'failed',
        status: 'failed',
        error: 'upstream died',
        usage: { usage: [{ inputTokens: 7, outputTokens: 2 }] },
      }),
    ]);
    renderWithProviders(<RunTreeView taskId="task-1" />);
    const row = rowFor(/claude run, failed/);
    expect(row.textContent).toContain('7↑');
    expect(row.textContent).not.toContain('$');
    fireEvent.click(row);
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('lists each provider/model with its cache and reasoning subsets', () => {
    seed([
      node({
        id: 'multi',
        usage: {
          usage: [
            {
              model: 'model-a',
              inputTokens: 130,
              outputTokens: 5,
              cachedInputTokens: 100,
              reasoningTokens: 2,
            },
            { model: 'model-b', inputTokens: 4, outputTokens: 3 },
          ],
        },
      }),
    ]);
    renderWithProviders(<RunTreeView taskId="task-1" />);
    fireEvent.click(rowFor(/claude run/));
    expect(
      screen.getByText('model-a · 130↑ 5↓ · cached 100 · reasoning 2'),
    ).toBeTruthy();
    expect(screen.getByText('model-b · 4↑ 3↓')).toBeTruthy();
    // 130 + 4: the cached subset is not added on top of the input total.
    expect(rowFor(/claude run/).textContent).toContain('134↑');
  });

  it('leaves an unreported count out instead of showing zero', async () => {
    seed([
      node({
        id: 'partial',
        provider: 'codex',
        usage: { usage: [{ outputTokens: 5 }] },
      }),
      node({
        id: 'zero',
        provider: 'cursor',
        usage: { usage: [{ inputTokens: 0, outputTokens: 0 }] },
      }),
    ]);
    renderWithProviders(<RunTreeView taskId="task-1" />);
    const codexRow = rowFor(/codex run/).parentElement!;
    fireEvent.click(rowFor(/codex run/));
    await waitFor(() => expect(codexRow.textContent).toContain('5↓'));
    expect(codexRow.textContent).not.toContain('0↑');

    const cursorRow = rowFor(/cursor run/).parentElement!;
    fireEvent.click(rowFor(/cursor run/));
    await waitFor(() => expect(cursorRow.textContent).toContain('0↑ 0↓'));
  });

  it('falls back to stored totals for a run recorded before usage was kept', () => {
    seed([
      node({ id: 'legacy', provider: 'gemini', costUsd: 0.5, tokensIn: 1500 }),
    ]);
    renderWithProviders(<RunTreeView taskId="task-1" />);
    const row = rowFor(/gemini run/);
    expect(row.textContent).toContain('$0.50');
    expect(row.textContent).toContain('1.5k↑');
    fireEvent.click(row);
    expect(screen.getByText('No usage reported')).toBeTruthy();
  });
});
