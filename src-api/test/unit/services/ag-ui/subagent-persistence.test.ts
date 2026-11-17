import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EventType, type BaseEvent } from '@ag-ui/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { closeDatabase } from '@/shared/db';
import {
  createBranch,
  createSession,
  createTask,
  getMessagesByBranch,
  getMessagesByTaskId,
  searchMessages,
} from '@/shared/db/operations';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import {
  dbMessagesToFullAGUI,
  dbMessagesToSubagents,
} from '@/shared/services/ag-ui/history';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';

import { defined } from '../../../helpers/defined';

const TASK_ID = 'task-subagent-persistence';

let tempHome = '';

async function emit(messages: AgentMessage[]): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', 'run-1');
  async function* source() {
    yield* messages;
  }
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(source())) events.push(event);
  return events;
}

/** Runs real emitter output through the persister, as the detached pipeline does. */
async function persist(messages: AgentMessage[]) {
  const persister = new AGUIEventPersister(
    TASK_ID,
    'run-1',
    tempHome,
    path.join(tempHome, 'session'),
  );
  for (const event of await emit(messages)) persister.handleEvent(event);
  return getMessagesByTaskId(TASK_ID);
}

const PARENT_AND_TWO_CHILDREN: AgentMessage[] = [
  { type: 'text', content: 'parent intro' },
  {
    type: 'subagent_started',
    subagentRunId: 'task-a',
    subagentName: 'Scan',
    subagentDescription: 'Scan the repo',
    parentToolCallId: 'toolu_A',
  },
  {
    type: 'subagent_started',
    subagentRunId: 'task-b',
    subagentName: 'Scan',
    subagentDescription: 'Scan the repo',
    parentToolCallId: 'toolu_B',
  },
  { type: 'text', content: 'from a', subagentRunId: 'task-a' },
  { type: 'text', content: 'from b', subagentRunId: 'task-b' },
  {
    type: 'tool_use',
    id: 'tu-1',
    name: 'Read',
    input: { path: 'x' },
    subagentRunId: 'task-a',
  },
  {
    type: 'tool_result',
    toolUseId: 'tu-1',
    output: 'file body',
    subagentRunId: 'task-a',
  },
  { type: 'subagent_finished', subagentRunId: 'task-a', output: 'Found 3' },
  {
    type: 'subagent_error',
    subagentRunId: 'task-b',
    message: 'Stopped by user',
    code: 'stopped',
  },
  { type: 'text', content: 'parent wrap-up' },
];

describe('sub-agent persistence and history replay', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'neumar-subagent-persist-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
    createSession({ id: 'session-subagent', prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: 'session-subagent',
      task_index: 0,
      prompt: 'test',
      work_dir: tempHome,
    });
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('records each invocation with its ownership and terminal status', async () => {
    const rows = await persist(PARENT_AND_TWO_CHILDREN);

    const timing = {
      startedAt: expect.any(Number),
      endedAt: expect.any(Number),
    };
    expect(dbMessagesToSubagents(rows)).toEqual([
      {
        id: 'task-a',
        name: 'Scan',
        description: 'Scan the repo',
        parentToolCallId: 'toolu_A',
        status: 'completed',
        result: 'Found 3',
        ...timing,
      },
      {
        id: 'task-b',
        name: 'Scan',
        description: 'Scan the repo',
        parentToolCallId: 'toolu_B',
        status: 'error',
        error: { message: 'Stopped by user', code: 'stopped' },
        ...timing,
      },
    ]);
  });

  it('keeps child output out of the parent message when history reloads', async () => {
    const rows = await persist(PARENT_AND_TWO_CHILDREN);
    const history = dbMessagesToFullAGUI(rows);

    expect(
      history.filter((m) => !m.subagentRunId).map((m) => m.content),
    ).toEqual(['parent intro', 'parent wrap-up']);
    expect(history.find((m) => m.subagentRunId === 'task-a')).toMatchObject({
      role: 'assistant',
      content: 'from a',
    });
    expect(history.find((m) => m.subagentRunId === 'task-b')).toMatchObject({
      content: 'from b',
    });
    const childTool = history.find((m) =>
      m.toolCalls?.some((tc) => tc.id === 'tu-1'),
    );
    expect(childTool?.subagentRunId).toBe('task-a');
    expect(history.find((m) => m.role === 'tool')).toMatchObject({
      toolCallId: 'tu-1',
      subagentRunId: 'task-a',
    });
    // Cards come from dbMessagesToSubagents, never as chat messages.
    expect(history.some((m) => m.content?.includes('"status"'))).toBe(false);
  });

  it('closes a child the run never finished as an error, so history never shows it running', async () => {
    const rows = await persist([
      {
        type: 'subagent_started',
        subagentRunId: 'task-a',
        subagentName: 'Scan',
      },
      { type: 'text', content: 'working', subagentRunId: 'task-a' },
    ]);

    expect(dbMessagesToSubagents(rows)).toEqual([
      expect.objectContaining({
        id: 'task-a',
        status: 'error',
        error: expect.objectContaining({ code: 'run_ended' }),
      }),
    ]);
  });

  it('closes a running child when the run ends with a RUN_ERROR the emitter never saw', async () => {
    const persister = new AGUIEventPersister(TASK_ID, 'run-1', tempHome);
    persister.handleEvent({
      type: EventType.SUBAGENT_STARTED,
      subagentRunId: 'task-a',
      name: 'Scan',
    } as BaseEvent);
    persister.handleEvent({
      type: EventType.RUN_ERROR,
      message: 'transport failed',
    } as BaseEvent);

    expect(dbMessagesToSubagents(getMessagesByTaskId(TASK_ID))).toEqual([
      expect.objectContaining({
        id: 'task-a',
        status: 'error',
        error: expect.objectContaining({ code: 'run_ended' }),
      }),
    ]);
  });

  it('records nesting from the parent invocation id', async () => {
    const rows = await persist([
      { type: 'subagent_started', subagentRunId: 'task-a', subagentName: 'A' },
      {
        type: 'subagent_started',
        subagentRunId: 'task-n',
        subagentName: 'Nested',
        parentSubagentRunId: 'task-a',
        parentToolCallId: 'toolu_N',
      },
      { type: 'subagent_finished', subagentRunId: 'task-n', output: 'n' },
      { type: 'subagent_finished', subagentRunId: 'task-a', output: 'a' },
    ]);

    expect(
      dbMessagesToSubagents(rows).find((r) => r.id === 'task-n'),
    ).toMatchObject({ parentSubagentRunId: 'task-a' });
  });

  it('keeps sub-agent records out of content search', async () => {
    const rows = await persist(PARENT_AND_TWO_CHILDREN);

    expect(searchMessages(TASK_ID, 'Found 3')).toEqual([]);
    expect(rows.find((r) => r.type === 'subagent')?.content).toContain(
      'Found 3',
    );
  });

  it('keeps ownership when a thread is branched', async () => {
    const rows = await persist(PARENT_AND_TWO_CHILDREN);
    const last = defined(rows[rows.length - 1]);
    const branchId = createBranch(TASK_ID, last.id);

    const branched = getMessagesByBranch(TASK_ID, branchId);
    expect(
      branched.filter((r) => r.subagent_run_id === 'task-a').length,
    ).toBeGreaterThan(0);
    expect(dbMessagesToSubagents(branched).map((r) => r.id)).toEqual([
      'task-a',
      'task-b',
    ]);
  });
});
