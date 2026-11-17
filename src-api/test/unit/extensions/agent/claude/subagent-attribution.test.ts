import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { ClaudeAgent } from '@/extensions/agent/claude';

import { LimitedSet } from '@/shared/utils/limited-set';

const MODEL = 'claude-test-model';

type ProcessMessage = (
  message: unknown,
  sessionId: string,
  sentTextHashes: LimitedSet<string>,
  sentToolIds: LimitedSet<string>,
  taskId?: string,
  toolNames?: Map<string, string>,
) => Generator<AgentMessage>;

/**
 * Runs SDK-shaped messages through the adapter's real mapping. The mapper is
 * private, so it is reached through a narrow cast; the inputs are the SDK
 * message shapes, not hand-built AgentMessages.
 */
function mapSdkMessages(messages: unknown[]): AgentMessage[] {
  const agent = new ClaudeAgent({ provider: 'claude', model: MODEL });
  const processMessage = (
    agent as unknown as { processMessage: ProcessMessage }
  ).processMessage.bind(agent);
  const sentText = new LimitedSet<string>(100);
  const sentTools = new LimitedSet<string>(100);
  const out: AgentMessage[] = [];
  for (const message of messages) {
    out.push(
      ...processMessage(message, 'session-1', sentText, sentTools, 'task-1'),
    );
  }
  return out;
}

const taskStarted = (
  taskId: string,
  toolUseId: string,
  description: string,
  subagentType?: string,
  extra: Record<string, unknown> = {},
) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: taskId,
  tool_use_id: toolUseId,
  description,
  task_type: 'local_agent',
  ...(subagentType ? { subagent_type: subagentType } : {}),
  ...extra,
});

const childText = (parent: string | null, text: string) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'text', text }] },
});

const childToolUse = (parent: string | null, id: string, name: string) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_use', id, name, input: {} }] },
});

const taskNotification = (
  taskId: string,
  toolUseId: string,
  status: 'completed' | 'failed' | 'stopped',
  summary: string,
) => ({
  type: 'system',
  subtype: 'task_notification',
  task_id: taskId,
  tool_use_id: toolUseId,
  status,
  summary,
  output_file: '',
});

describe('Claude adapter sub-agent attribution', () => {
  const out = mapSdkMessages([
    taskStarted('task-a', 'toolu_A', 'Scan', 'explore'),
    taskStarted('task-b', 'toolu_B', 'Scan'),
    childText('toolu_A', 'from a'),
    childText(null, 'from a'),
    childToolUse('toolu_B', 'tu-b', 'Read'),
    childToolUse('toolu_A', 'toolu_N', 'Task'),
    taskStarted('task-n', 'toolu_N', 'Nested'),
    childText('toolu_unknown', 'orphan'),
    taskNotification('task-a', 'toolu_A', 'completed', 'Found 3'),
    taskNotification('task-b', 'toolu_B', 'stopped', 'Stopped by user'),
  ]);

  const ofType = (type: AgentMessage['type']) =>
    out.filter((message) => message.type === type);

  it('starts each invocation with its SDK task id and parent tool call', () => {
    const started = ofType('subagent_started');
    expect(started[0]).toMatchObject({
      subagentRunId: 'task-a',
      subagentName: 'explore',
      subagentDescription: 'Scan',
      parentToolCallId: 'toolu_A',
    });
    expect(started[1]).toMatchObject({
      subagentRunId: 'task-b',
      subagentName: 'Scan',
    });
  });

  it('links a nested invocation to the child that issued its Task call', () => {
    const nested = ofType('subagent_started').find(
      (message) => message.subagentRunId === 'task-n',
    );
    expect(nested).toMatchObject({
      parentSubagentRunId: 'task-a',
      parentToolCallId: 'toolu_N',
    });
  });

  it('attributes child text and tool calls to their invocation by parent_tool_use_id', () => {
    const childTextMsg = out.find(
      (message) =>
        message.type === 'text' && message.subagentRunId === 'task-a',
    );
    expect(childTextMsg).toMatchObject({ content: 'from a' });

    const childTool = out.find(
      (message) => message.type === 'tool_use' && message.id === 'tu-b',
    );
    expect(childTool).toMatchObject({ subagentRunId: 'task-b' });
  });

  it('keeps parent text that matches child text, instead of deduping it away', () => {
    const parentText = out.filter(
      (message) => message.type === 'text' && message.content === 'from a',
    );
    expect(parentText).toHaveLength(2);
    expect(
      parentText.some((message) => message.subagentRunId === undefined),
    ).toBe(true);
  });

  it('keeps a message whose parent call is unknown with the parent run', () => {
    const orphan = out.find(
      (message) => message.type === 'text' && message.content === 'orphan',
    );
    expect(orphan).toBeDefined();
    expect(orphan?.subagentRunId).toBeUndefined();
  });

  it('reports a completed invocation as finished and a stopped one as an error', () => {
    expect(ofType('subagent_finished')).toEqual([
      expect.objectContaining({ subagentRunId: 'task-a', output: 'Found 3' }),
    ]);
    expect(ofType('subagent_error')).toEqual([
      expect.objectContaining({ subagentRunId: 'task-b', code: 'stopped' }),
    ]);
  });

  it('keeps the legacy step messages tagged with their invocation for non-AG-UI consumers', () => {
    const legacySteps = ofType('step_started');
    expect(legacySteps.map((message) => message.subagentRunId)).toEqual([
      'task-a',
      'task-b',
      'task-n',
    ]);
  });
});

describe('Claude adapter: tasks that are not sub-agents', () => {
  const out = mapSdkMessages([
    taskStarted('bash-1', 'toolu_bash', 'sleep 300', undefined, {
      task_type: 'local_bash',
    }),
    taskStarted('watch-1', 'toolu_watch', 'watcher', undefined, {
      ambient: true,
    }),
    taskStarted('quiet-1', 'toolu_quiet', 'housekeeping', undefined, {
      skip_transcript: true,
    }),
    childText('toolu_bash', 'bash output'),
    taskNotification('bash-1', 'toolu_bash', 'completed', 'done'),
    taskNotification('watch-1', 'toolu_watch', 'stopped', 'stopped'),
  ]);

  it('never reports them as sub-agents', () => {
    expect(out.filter((m) => m.type.startsWith('subagent_'))).toEqual([]);
  });

  it('keeps their legacy step messages untagged so AG-UI still shows them as steps', () => {
    const steps = out.filter(
      (m) => m.type === 'step_started' || m.type === 'step_finished',
    );
    expect(steps).toHaveLength(5);
    expect(steps.every((m) => m.subagentRunId === undefined)).toBe(true);
  });

  it('keeps text whose parent call is a bash task with the parent run', () => {
    const text = out.find(
      (m) => m.type === 'text' && m.content === 'bash output',
    );
    expect(text).toBeDefined();
    expect(text?.subagentRunId).toBeUndefined();
  });
});
