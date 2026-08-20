import { describe, expect, it } from 'vitest';

import { groupMessages } from '@/components/task/groupMessages';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';

function tool(name: string, id: string) {
  return {
    id,
    type: 'function' as const,
    function: { name, arguments: '{}' },
  };
}

/** Assistant step: narration + a tool call, the shape Claude actually emits. */
function step(id: string, content: string, toolName: string): AGUIMessage {
  return {
    id,
    role: 'assistant',
    content,
    toolCalls: [tool(toolName, `tc-${id}`)],
  };
}

function result(id: string): AGUIMessage {
  return { id: `r-${id}`, role: 'tool', content: 'ok', toolCallId: `tc-${id}` };
}

describe('groupMessages — activity collapsing', () => {
  it('collapses an entire multi-step turn into one activity item plus the answer', () => {
    const messages: AGUIMessage[] = [
      { id: 'u1', role: 'user', content: 'Create a video along with it' },
      step('a1', 'Let me scaffold the project.', 'Bash'),
      result('a1'),
      step('a2', 'Project scaffolded. Reading the docs.', 'Read'),
      result('a2'),
      {
        id: 'a3',
        role: 'assistant',
        content: '',
        toolCalls: [tool('Write', 'tc-a3')],
      },
      result('a3'),
      {
        id: 'a4',
        role: 'assistant',
        content: "Video's done: output/recap.mp4",
      },
    ];

    const items = groupMessages(messages, null, false);

    expect(items.map((i) => i.type)).toEqual([
      'message',
      'activity',
      'message',
    ]);
    const activity = items[1];
    if (activity.type !== 'activity') throw new Error('expected activity');
    // Two narration notes + three tool calls, in emission order.
    expect(activity.entries.map((e) => e.kind)).toEqual([
      'note',
      'tool',
      'note',
      'tool',
      'tool',
    ]);
    expect(items[2]).toMatchObject({ type: 'message', key: 'a4' });
  });

  it('leaves a plain question/answer turn untouched', () => {
    const items = groupMessages(
      [
        { id: 'u1', role: 'user', content: 'hi' },
        { id: 'a1', role: 'assistant', content: 'hello' },
      ],
      null,
      false,
    );
    expect(items.map((i) => i.type)).toEqual(['message', 'message']);
  });

  it('keeps every trailing prose message as part of the answer', () => {
    const items = groupMessages(
      [
        { id: 'u1', role: 'user', content: 'go' },
        step('a1', 'Working.', 'Bash'),
        result('a1'),
        { id: 'a2', role: 'assistant', content: 'Draft saved.' },
        { id: 'a3', role: 'assistant', content: 'Completed task.' },
      ],
      null,
      false,
    );
    expect(items.map((i) => i.type)).toEqual([
      'message',
      'activity',
      'message',
      'message',
    ]);
  });

  it('hoists AskUserQuestion out of the group so the card stays interactive', () => {
    const items = groupMessages(
      [
        { id: 'u1', role: 'user', content: 'go' },
        step('a1', 'Checking.', 'Bash'),
        result('a1'),
        {
          id: 'a2',
          role: 'assistant',
          content: '',
          toolCalls: [tool('AskUserQuestion', 'tc-ask')],
        },
        // The answer echo is absorbed by the card, not rendered as a bubble.
        { id: 'u2', role: 'user', content: 'option A' },
        { id: 'a3', role: 'assistant', content: 'Done.' },
      ],
      null,
      false,
    );
    expect(items.map((i) => i.type)).toEqual([
      'message',
      'activity',
      'tool-group',
      'message',
    ]);
    expect(items[3]).toMatchObject({ key: 'a3' });
  });

  it('hoists error messages so failures are never hidden behind a collapse', () => {
    const items = groupMessages(
      [
        { id: 'u1', role: 'user', content: 'go' },
        step('a1', 'Trying.', 'Bash'),
        result('a1'),
        { id: 'a2', role: 'assistant', content: 'boom', isError: true },
        step('a3', 'Retrying.', 'Bash'),
        result('a3'),
        { id: 'a4', role: 'assistant', content: 'Recovered.' },
      ],
      null,
      false,
    );
    expect(items.map((i) => i.type)).toEqual([
      'message',
      'activity',
      'message',
      'activity',
      'message',
    ]);
  });

  it('drops the plan JSON whether it arrives bare or fence-wrapped', () => {
    const plan = '{"type":"plan","goal":"g","steps":[]}';
    const items = groupMessages(
      [
        { id: 'u1', role: 'user', content: 'go' },
        { id: 'a1', role: 'assistant', content: '```json\n' + plan + '\n```' },
        { id: 'a2', role: 'assistant', content: plan },
        { id: 'a3', role: 'assistant', content: 'Real answer.' },
      ],
      null,
      false,
    );
    expect(items.map((i) => i.type)).toEqual(['message', 'message']);
    expect(items[1]).toMatchObject({ key: 'a3' });
  });

  it('reasoning blocks never surface in the thread', () => {
    const items = groupMessages(
      [
        { id: 'u1', role: 'user', content: 'go' },
        { id: 'x1', role: 'reasoning', content: 'internal scratchpad' },
        { id: 'a1', role: 'assistant', content: 'Answer.' },
      ],
      null,
      false,
    );
    expect(items.map((i) => i.type)).toEqual(['message', 'message']);
  });
});
