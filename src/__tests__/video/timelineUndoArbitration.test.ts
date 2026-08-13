import { describe, expect, it } from 'vitest';

import {
  resolveTimelineRedoTarget,
  resolveTimelineUndoTarget,
} from '@/components/video/timeline/timelineUndoArbitration';
import type { VideoAgentJournalEntry } from '@/shared/types/video';

describe('timeline undo arbitration', () => {
  it('undoes the latest manual edit when it is newer than the agent entry', () => {
    expect(
      resolveTimelineUndoTarget({
        agentJournal: [
          agentEntry({
            id: 'agent-1',
            ts: '2026-05-25T10:00:00.000Z',
          }),
        ],
        userUndoCreatedAt: '2026-05-25T10:01:00.000Z',
      }),
    ).toEqual({ kind: 'user' });
  });

  it('undoes the latest agent entry when it is newer than the manual edit', () => {
    expect(
      resolveTimelineUndoTarget({
        agentJournal: [
          agentEntry({
            id: 'agent-1',
            ts: '2026-05-25T10:02:00.000Z',
          }),
        ],
        userUndoCreatedAt: '2026-05-25T10:01:00.000Z',
      }),
    ).toEqual({ kind: 'agent', entryId: 'agent-1' });
  });

  it('redo ignores agent entries branched by a newer manual edit', () => {
    expect(
      resolveTimelineRedoTarget({
        agentJournal: [
          agentEntry({
            id: 'agent-1',
            ts: '2026-05-25T10:00:00.000Z',
            undone: true,
          }),
        ],
        latestUserEditCreatedAt: '2026-05-25T10:01:00.000Z',
        userRedoCreatedAt: null,
      }),
    ).toBeNull();
  });

  it('redoes the latest redoable source when no branch blocks it', () => {
    expect(
      resolveTimelineRedoTarget({
        agentJournal: [
          agentEntry({
            id: 'agent-1',
            ts: '2026-05-25T10:03:00.000Z',
            undone: true,
          }),
        ],
        latestUserEditCreatedAt: '2026-05-25T10:01:00.000Z',
        userRedoCreatedAt: '2026-05-25T10:02:00.000Z',
      }),
    ).toEqual({ kind: 'agent', entryId: 'agent-1' });
  });
});

function agentEntry({
  id,
  ts,
  undone = false,
}: {
  id: string;
  ts: string;
  undone?: boolean;
}): VideoAgentJournalEntry {
  return {
    id,
    ts,
    tool: 'setCaption',
    args: {},
    result: {},
    diff: [{ op: 'replace', path: '/name', value: 'after' }],
    inverseDiff: [{ op: 'replace', path: '/name', value: 'before' }],
    undone,
  };
}
