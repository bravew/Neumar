import { describe, expect, it } from 'vitest';

import { groupMessages } from '@/components/task/groupMessages';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';

const tool = (name: string, id: string) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: '{}' },
});

const activityEntries = (messages: AGUIMessage[]) => {
  const items = groupMessages(messages, null, false);
  const activity = items.find((i) => i.type === 'activity');
  if (activity?.type !== 'activity') throw new Error('expected activity');
  return { items, entries: activity.entries };
};

describe('groupMessages — sub-agent attribution', () => {
  it('keeps a sub-agent report out of the answer, even when it is the last message', () => {
    const { items } = activityEntries([
      { id: 'u1', role: 'user', content: 'scan the repo' },
      {
        id: 'p1',
        role: 'assistant',
        content: 'Delegating.',
        toolCalls: [tool('Task', 'tc-task')],
      },
      {
        id: 'c1',
        role: 'assistant',
        content: 'Found 3 issues.',
        subagentRunId: 'task-a',
      },
    ]);

    // user message + one activity group; the child's prose is not an answer.
    expect(items.map((i) => i.type)).toEqual(['message', 'activity']);
  });

  it("still shows the main agent's closing prose as the answer", () => {
    const { items } = activityEntries([
      { id: 'u1', role: 'user', content: 'scan the repo' },
      {
        id: 'c1',
        role: 'assistant',
        content: 'Found 3 issues.',
        subagentRunId: 'task-a',
      },
      { id: 'p2', role: 'assistant', content: 'Here is the summary.' },
    ]);

    expect(items.map((i) => i.type)).toEqual([
      'message',
      'activity',
      'message',
    ]);
    expect(items[2]).toMatchObject({ key: 'p2' });
  });

  it('tags child notes and tool calls with their invocation and leaves the parent untagged', () => {
    const { entries } = activityEntries([
      { id: 'u1', role: 'user', content: 'go' },
      {
        id: 'p1',
        role: 'assistant',
        content: 'Delegating.',
        toolCalls: [tool('Task', 'tc-task')],
      },
      {
        id: 'c1',
        role: 'assistant',
        content: 'Reading.',
        toolCalls: [tool('Read', 'tc-read')],
        subagentRunId: 'task-a',
      },
      { id: 'p2', role: 'assistant', content: 'Done.' },
    ]);

    const owners = entries.map((e) => e.subagentRunId);
    expect(owners).toEqual([undefined, undefined, 'task-a', 'task-a']);
    // An untagged entry carries no `subagentRunId` key at all.
    expect('subagentRunId' in (entries[0] ?? {})).toBe(false);
  });
});
