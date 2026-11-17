/**
 * Real sub-agent invocations come from the thread store (AG-UI SUBAGENT_*
 * events and saved history); step events only cover other SDK tasks.
 */
import { EventType } from '@ag-ui/core';
import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubAgentPanel } from '@/components/task/SubAgentPanel';
import { mergeSubAgents, useSubAgents } from '@/shared/hooks/useSubAgents';
import { useThreadStore } from '@/shared/stores/thread-store';
import type { ThreadSubagent } from '@/shared/stores/thread-store';

import { renderWithProviders } from './helpers/render-with-providers';

// No task event bus here; step events are covered by useSubAgents.stop.test.
vi.mock('@/shared/hooks/useTaskEventSource', () => ({
  useTaskEventSource: () => {},
}));

const TASK = 'task-recorded';

afterEach(() => {
  useThreadStore.setState({ threads: {} });
});

const recorded: ThreadSubagent[] = [
  {
    id: 'task-a',
    name: 'Scan',
    description: 'Scan the repo',
    status: 'completed',
    startedAt: 1_000,
    endedAt: 4_000,
    result: 'Found 3 issues',
  },
  {
    id: 'task-n',
    name: 'Nested',
    parentSubagentRunId: 'task-a',
    status: 'error',
    startedAt: 1_500,
    endedAt: 2_000,
    error: { message: 'Stopped by user', code: 'stopped' },
  },
  {
    id: 'task-f',
    name: 'Crashed',
    status: 'error',
    startedAt: 1_000,
    endedAt: 2_000,
    error: { message: 'boom' },
  },
];

describe('mergeSubAgents', () => {
  it('maps a stop to cancelled and any other error to failed, keeping detail', () => {
    const merged = mergeSubAgents(recorded, []);

    expect(merged).toMatchObject([
      {
        id: 'task-a',
        status: 'completed',
        result: 'Found 3 issues',
        description: 'Scan the repo',
        startedAt: 1_000,
        completedAt: 4_000,
      },
      {
        id: 'task-n',
        status: 'cancelled',
        errorMessage: 'Stopped by user',
        parentSubagentRunId: 'task-a',
      },
      { id: 'task-f', status: 'failed', errorMessage: 'boom' },
    ]);
  });

  it('lets an invocation win over a step with the same id and keeps step-only tasks', () => {
    const step = (id: string) => ({
      id,
      name: 'step',
      status: 'running' as const,
      startedAt: 1,
    });

    const merged = mergeSubAgents(recorded, [step('task-a'), step('bg-bash')]);

    expect(merged.map((a) => a.id)).toEqual([
      'task-a',
      'task-n',
      'task-f',
      'bg-bash',
    ]);
    expect(merged.find((a) => a.id === 'task-a')?.status).toBe('completed');
  });
});

describe('useSubAgents — thread store', () => {
  it('shows a live invocation and its outcome as the events arrive', () => {
    const { result } = renderHook(() => useSubAgents(TASK, true));
    expect(result.current).toEqual([]);

    act(() => {
      useThreadStore.getState().applyAGUIEvent(TASK, {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      });
    });
    expect(result.current).toMatchObject([{ id: 'task-a', status: 'running' }]);

    act(() => {
      useThreadStore.getState().applyAGUIEvent(TASK, {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: 'task-a',
        result: 'done',
      });
    });
    expect(result.current).toMatchObject([
      { id: 'task-a', status: 'completed', result: 'done' },
    ]);
  });

  it('restores invocations from saved history without any live event', () => {
    useThreadStore
      .getState()
      .hydrateFromDB(TASK, [], false, { subagents: recorded });

    const { result } = renderHook(() => useSubAgents(TASK, false));

    expect(result.current.map((a) => a.id)).toEqual([
      'task-a',
      'task-n',
      'task-f',
    ]);
  });

  it('does not show another thread’s invocations', () => {
    useThreadStore
      .getState()
      .hydrateFromDB('other-task', [], false, { subagents: recorded });

    const { result } = renderHook(() => useSubAgents(TASK, false));

    expect(result.current).toEqual([]);
  });
});

describe('SubAgentPanel — recorded detail', () => {
  it('indents a nested invocation and shows its description, result, and error when expanded', async () => {
    const user = userEvent.setup();
    const { result } = renderHook(() => useSubAgents(TASK, false));
    act(() => {
      useThreadStore
        .getState()
        .hydrateFromDB(TASK, [], false, { subagents: recorded });
    });

    renderWithProviders(
      <SubAgentPanel subAgents={result.current} onCancel={() => {}} />,
    );

    const rows = screen
      .getAllByRole('button')
      .filter((b) => /Scan|Nested|Crashed/.test(b.textContent ?? ''));
    expect(rows).toHaveLength(3);
    // The nested row is indented further than its parent.
    const pad = (el: HTMLElement) => parseFloat(el.style.paddingLeft);
    expect(pad(rows[1])).toBeGreaterThan(pad(rows[0]));
    expect(pad(rows[2])).toBe(pad(rows[0]));

    await user.click(rows[0]);
    expect(screen.getByText('Scan the repo')).toBeInTheDocument();
    expect(screen.getByText('Found 3 issues')).toBeInTheDocument();

    await user.click(rows[2]);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
