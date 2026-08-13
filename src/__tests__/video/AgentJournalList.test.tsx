import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentJournalList } from '@/components/video/AgentJournalList';
import type { VideoAgentJournalEntry } from '@/shared/types/video';

const labels = {
  title: 'Journal',
  applied: 'Applied',
  undone: 'Undone',
  passed: 'Passed',
  failedReport: 'Needs attention',
  undo: 'Undo',
  redo: 'Redo',
};

const actionLabels = {
  setCaption: 'Set caption',
  addScene: 'Add scene',
  verifyRender: 'Verify render',
};

describe('AgentJournalList', () => {
  it('renders reversible journal controls by entry state', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    render(
      <AgentJournalList
        entries={[
          entry('caption-1', 'setCaption', false),
          entry('scene-1', 'addScene', true),
          {
            ...entry('verify-1', 'verifyRender', false),
            result: { status: 'failed' },
            diff: [],
            inverseDiff: [],
          },
        ]}
        labels={labels}
        actionLabels={actionLabels}
        busyEntryId={null}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );

    expect(screen.getByText('Journal')).toBeInTheDocument();
    expect(screen.getByText('Set caption')).toBeInTheDocument();
    expect(screen.getByText('Undone')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo: Set caption' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo: Add scene' }));

    expect(onUndo).toHaveBeenCalledWith('caption-1');
    expect(onRedo).toHaveBeenCalledWith('scene-1');
    expect(
      screen.queryByRole('button', { name: 'Undo: Verify render' }),
    ).not.toBeInTheDocument();
  });
});

function entry(
  id: string,
  tool: string,
  undone: boolean,
): VideoAgentJournalEntry {
  return {
    id,
    ts: '2026-05-20T04:00:00.000Z',
    tool,
    args: {},
    result: {},
    reasoning: 'test',
    diff: [{ op: 'replace', path: '/storyboard/status', value: 'edited' }],
    inverseDiff: [
      { op: 'replace', path: '/storyboard/status', value: 'draft' },
    ],
    undone,
  };
}
