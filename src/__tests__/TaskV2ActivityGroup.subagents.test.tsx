import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityGroup } from '@/components/task/TaskV2ActivityGroup';
import type {
  ActivityEntry,
  AGUIToolCall,
} from '@/components/task/TaskV2MessageBubble.types';
import type { ThreadSubagent } from '@/shared/stores/thread-store';

import { renderWithProviders } from './helpers/render-with-providers';

let threadSubagents: ThreadSubagent[] = [];

vi.mock('@/shared/providers/agui-provider', () => ({
  useThreadSubagents: () => threadSubagents,
}));

const call = (id: string, name: string): AGUIToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
});

beforeEach(() => {
  threadSubagents = [];
});

const entries: ActivityEntry[] = [
  { kind: 'note', id: 'n1', text: 'Delegating the scan.' },
  { kind: 'note', id: 'n2', text: 'Reading config.', subagentRunId: 'task-a' },
  { kind: 'tool', tc: call('t1', 'Read'), subagentRunId: 'task-a' },
  { kind: 'tool', tc: call('t2', 'Read'), subagentRunId: 'task-b' },
];

async function renderExpanded() {
  const user = userEvent.setup();
  renderWithProviders(<ActivityGroup entries={entries} allMessages={[]} />);
  await user.click(screen.getByRole('button', { name: /./ }));
}

describe('ActivityGroup — sub-agent attribution', () => {
  it('sets a sub-agent’s steps apart from the main agent’s, once per run of steps', async () => {
    await renderExpanded();

    // Outside a provider no names are known, so each block falls back to the
    // generic label; one label per owner run, not one per row.
    expect(screen.getAllByText('Sub-agent')).toHaveLength(2);
    const note = screen.getByText('Delegating the scan.');
    expect(note.closest('.border-l')).toBeNull();
    const owned = screen.getByText('Reading config.').closest('.border-l');
    expect(owned).not.toBeNull();
    expect(within(owned as HTMLElement).getByText('Sub-agent')).toBeVisible();
  });

  it('does not fold identical tool calls from different sub-agents into one polling row', async () => {
    await renderExpanded();

    // Two `Read` calls by two owners stay two rows; a fold would read "· 2".
    expect(screen.queryByText(/Read · 2/)).not.toBeInTheDocument();
  });

  it('labels each block with the sub-agent’s name when the thread knows it', async () => {
    threadSubagents = [
      { id: 'task-a', name: 'Scan', status: 'completed' },
      { id: 'task-b', name: 'Review', status: 'completed' },
    ];

    await renderExpanded();

    expect(screen.getByText('Scan')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.queryByText('Sub-agent')).not.toBeInTheDocument();
  });
});
