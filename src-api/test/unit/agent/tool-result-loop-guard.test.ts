import { describe, expect, it } from 'vitest';

import {
  ToolResultLoopGuard,
  withToolResultLoopGuard,
} from '@/core/agent/tool-result-loop-guard';
import type { AgentMessage } from '@/core/agent/types';

describe('ToolResultLoopGuard', () => {
  it('warns once for a repeated failing tool result signature', () => {
    const guard = new ToolResultLoopGuard({
      repeatedFailureThreshold: 3,
      consecutiveErrorThreshold: 99,
    });

    const toolUse: AgentMessage = {
      type: 'tool_use',
      id: 'call-1',
      name: 'Edit',
      input: { file: 'index.html', old: 'x', new: 'y' },
    };
    expect(guard.observe(toolUse)).toBeNull();

    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'call-1',
        output: 'Could not find old string',
        isError: true,
      }),
    ).toBeNull();

    expect(guard.observe({ ...toolUse, id: 'call-2' })).toBeNull();
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'call-2',
        output: 'Could not find old string',
        isError: true,
      }),
    ).toBeNull();

    expect(guard.observe({ ...toolUse, id: 'call-3' })).toBeNull();
    const warning = guard.observe({
      type: 'tool_result',
      toolUseId: 'call-3',
      output: 'Could not find old string',
      isError: true,
    });

    expect(warning).toMatch(/Repeated tool failure detected/);
    expect(guard.isTripped).toBe(true);
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'call-4',
        output: 'Could not find old string',
        isError: true,
      }),
    ).toBeNull();
  });

  it('keeps repeated mutation failures across successful read-only inspections', () => {
    const guard = new ToolResultLoopGuard({
      repeatedFailureThreshold: 2,
      consecutiveErrorThreshold: 99,
    });

    expect(
      guard.observe({
        type: 'tool_use',
        id: 'edit-1',
        name: 'Edit',
        input: { file: 'a.ts', old: 'missing', new: 'value' },
      }),
    ).toBeNull();
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'edit-1',
        output: 'Could not find old string',
        isError: true,
      }),
    ).toBeNull();

    expect(
      guard.observe({
        type: 'tool_use',
        id: 'read-1',
        name: 'Read',
        input: { file: 'a.ts' },
      }),
    ).toBeNull();
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'read-1',
        output: 'file content',
        isError: false,
      }),
    ).toBeNull();

    expect(
      guard.observe({
        type: 'tool_use',
        id: 'edit-2',
        name: 'Edit',
        input: { file: 'a.ts', old: 'missing', new: 'value' },
      }),
    ).toBeNull();
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'edit-2',
        output: 'Could not find old string',
        isError: true,
      }),
    ).toMatch(/Repeated tool failure detected/);
  });

  it('clears repeated failure state after a successful mutation', () => {
    const guard = new ToolResultLoopGuard({
      repeatedFailureThreshold: 2,
      consecutiveErrorThreshold: 99,
    });

    expect(
      guard.observe({
        type: 'tool_use',
        id: 'edit-1',
        name: 'Edit',
        input: { file: 'a.ts', old: 'missing', new: 'value' },
      }),
    ).toBeNull();
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'edit-1',
        output: 'Could not find old string',
        isError: true,
      }),
    ).toBeNull();

    expect(
      guard.observe({
        type: 'tool_use',
        id: 'write-1',
        name: 'Write',
        input: { file: 'a.ts' },
      }),
    ).toBeNull();
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'write-1',
        output: 'wrote file',
        isError: false,
      }),
    ).toBeNull();

    expect(
      guard.observe({
        type: 'tool_use',
        id: 'edit-2',
        name: 'Edit',
        input: { file: 'a.ts', old: 'missing', new: 'value' },
      }),
    ).toBeNull();
    expect(
      guard.observe({
        type: 'tool_result',
        toolUseId: 'edit-2',
        output: 'Could not find old string',
        isError: true,
      }),
    ).toBeNull();
  });

  it('emits transient warning messages without dropping source messages', async () => {
    async function* source(): AsyncGenerator<AgentMessage> {
      yield {
        type: 'tool_use',
        id: 'a',
        name: 'Bash',
        input: { command: 'x' },
      };
      yield {
        type: 'tool_result',
        toolUseId: 'a',
        output: 'exit 1',
        isError: true,
      };
      yield {
        type: 'tool_use',
        id: 'b',
        name: 'Bash',
        input: { command: 'x' },
      };
      yield {
        type: 'tool_result',
        toolUseId: 'b',
        output: 'exit 1',
        isError: true,
      };
    }

    const messages: AgentMessage[] = [];
    for await (const message of withToolResultLoopGuard(source(), {
      repeatedFailureThreshold: 2,
      consecutiveErrorThreshold: 99,
    })) {
      messages.push(message);
    }

    expect(messages.map((message) => message.type)).toEqual([
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'planning_status',
    ]);
    expect(messages.at(-1)).toMatchObject({
      type: 'planning_status',
      subtype: 'tool_result_loop_warning',
      isProgress: true,
    });
  });
});
