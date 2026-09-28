import type { ThreadEvent } from '@openai/codex-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildSubprocessMcpConfig: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: vi.fn(function Codex() {
    return { startThread: mocks.startThread, resumeThread: vi.fn() };
  }),
}));

vi.mock('@/config/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/constants')>();
  return {
    ...actual,
    DEFAULT_WORK_DIR: '/tmp/neuma-codex-stream-mapper-test',
  };
});

vi.mock('@/shared/mcp/subprocess-bridge', () => ({
  buildSubprocessMcpConfig: mocks.buildSubprocessMcpConfig,
}));

vi.mock('@/shared/services/usage-logger', () => ({ logUsage: vi.fn() }));

vi.mock('@/shared/utils/codex-binary', () => ({
  getExtendedPath: vi.fn(() => '/usr/bin:/bin'),
  resolveCodexBinaryPath: vi.fn(() => '/usr/local/bin/codex'),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import type { AgentMessage } from '@/core/agent/types';

import { CodexAgent } from '@/extensions/agent/codex';
import {
  CodexStreamMapper,
  INTERRUPTED_TOOL_OUTPUT,
} from '@/extensions/agent/codex/stream-mapper';

function mapAll(events: ThreadEvent[], finish = false): AgentMessage[] {
  const mapper = new CodexStreamMapper('/tmp/codex-cwd');
  const out: AgentMessage[] = [];
  for (const event of events) out.push(...mapper.map(event));
  if (finish) out.push(...mapper.finish());
  return out;
}

const command = (
  status: 'in_progress' | 'completed' | 'failed',
  aggregated_output: string,
  exit_code?: number,
) => ({
  id: 'cmd-1',
  type: 'command_execution' as const,
  command: 'pnpm test',
  aggregated_output,
  status,
  ...(exit_code === undefined ? {} : { exit_code }),
});

describe('CodexStreamMapper', () => {
  it('announces a command on item.started and streams its output', () => {
    const messages = mapAll([
      { type: 'item.started', item: command('in_progress', '') },
      { type: 'item.updated', item: command('in_progress', 'line 1\n') },
      { type: 'item.updated', item: command('in_progress', 'line 1\n') },
      {
        type: 'item.updated',
        item: command('in_progress', 'line 1\nline 2\n'),
      },
      {
        type: 'item.completed',
        item: command('completed', 'line 1\nline 2\ndone\n', 0),
      },
    ]);

    expect(messages.map((m) => m.type)).toEqual([
      'tool_use',
      'tool_progress',
      'tool_progress',
      'tool_result',
    ]);
    const [toolUse, first, second, result] = messages;
    expect(toolUse).toMatchObject({
      name: 'Bash',
      input: { command: 'pnpm test' },
    });
    expect(first).toMatchObject({
      id: toolUse?.id,
      name: 'Bash',
      content: 'line 1\n',
      isProgress: true,
    });
    expect(second?.content).toBe('line 1\nline 2\n');
    expect(result).toMatchObject({
      toolUseId: toolUse?.id,
      output: 'line 1\nline 2\ndone\n',
      isError: false,
    });
  });

  it('still emits tool_use before the result when only item.completed arrives', () => {
    const messages = mapAll([
      { type: 'item.completed', item: command('failed', 'boom', 1) },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: 'tool_use', name: 'Bash' });
    expect(messages[1]).toMatchObject({
      type: 'tool_result',
      toolUseId: messages[0]?.id,
      isError: true,
    });
  });

  it('closes a command that produced no output', () => {
    const messages = mapAll([
      { type: 'item.started', item: command('in_progress', '') },
      { type: 'item.completed', item: command('completed', '', 0) },
    ]);
    expect(messages[1]).toMatchObject({
      type: 'tool_result',
      toolUseId: messages[0]?.id,
      output: '',
      isError: false,
    });
  });

  it('streams reasoning progress without repeating unchanged text', () => {
    const reasoning = (text: string) => ({
      id: 'r-1',
      type: 'reasoning' as const,
      text,
    });
    const messages = mapAll([
      { type: 'item.started', item: reasoning('') },
      { type: 'item.updated', item: reasoning('Reading the') },
      { type: 'item.updated', item: reasoning('Reading the tests') },
      { type: 'item.completed', item: reasoning('Reading the tests') },
    ]);
    expect(messages).toEqual([
      { type: 'thinking', content: 'Reading the' },
      { type: 'thinking', content: 'Reading the tests' },
    ]);
  });

  it('announces MCP and web search calls when they start', () => {
    const mcp = (status: 'in_progress' | 'completed') => ({
      id: 'mcp-1',
      type: 'mcp_tool_call' as const,
      server: 'google',
      tool: 'search_drive',
      arguments: { q: 'plan' },
      status,
      ...(status === 'completed'
        ? {
            result: {
              content: [{ type: 'text' as const, text: 'found 2' }],
              structured_content: null,
            },
          }
        : {}),
    });
    const search = { id: 'ws-1', type: 'web_search' as const, query: 'codex' };
    const messages = mapAll([
      { type: 'item.started', item: mcp('in_progress') },
      { type: 'item.updated', item: mcp('in_progress') },
      { type: 'item.started', item: search },
      { type: 'item.completed', item: search },
      { type: 'item.completed', item: mcp('completed') },
    ]);
    expect(messages).toEqual([
      {
        type: 'tool_use',
        name: 'search_drive',
        id: expect.any(String),
        input: { q: 'plan' },
      },
      {
        type: 'tool_use',
        name: 'WebSearch',
        id: expect.any(String),
        input: { query: 'codex' },
      },
      {
        type: 'tool_result',
        toolUseId: messages[1]?.id,
        output: 'Search completed',
        isError: false,
      },
      {
        type: 'tool_result',
        toolUseId: messages[0]?.id,
        output: 'found 2',
        isError: false,
      },
    ]);
  });

  it('renders each to-do list revision as a Claude-style TodoWrite call', () => {
    const todo = (done: boolean[]) => ({
      id: 'todo-1',
      type: 'todo_list' as const,
      items: [
        { text: 'Read code', completed: done[0] ?? false },
        { text: 'Write test', completed: done[1] ?? false },
      ],
    });
    const messages = mapAll([
      { type: 'item.started', item: todo([false, false]) },
      { type: 'item.updated', item: todo([true, false]) },
      { type: 'item.completed', item: todo([true, false]) },
    ]);

    expect(messages.map((m) => [m.type, m.name])).toEqual([
      ['tool_use', 'TodoWrite'],
      ['tool_result', undefined],
      ['tool_use', 'TodoWrite'],
      ['tool_result', undefined],
    ]);
    expect(messages[2]?.input).toEqual({
      todos: [
        { content: 'Read code', status: 'completed', activeForm: 'Read code' },
        { content: 'Write test', status: 'pending', activeForm: 'Write test' },
      ],
    });
    expect(messages[3]).toMatchObject({
      toolUseId: messages[2]?.id,
      output: '[x] Read code\n[ ] Write test',
      isError: false,
    });
  });

  it('keeps partial agent text and closes running tools when the turn fails', () => {
    const messages = mapAll([
      { type: 'item.started', item: command('in_progress', '') },
      { type: 'item.updated', item: command('in_progress', 'partial') },
      {
        type: 'item.updated',
        item: { id: 'msg-1', type: 'agent_message', text: 'Half an ans' },
      },
      { type: 'turn.failed', error: { message: 'stream disconnected' } },
    ]);
    const toolUseId = messages[0]?.id;

    expect(messages.slice(2)).toEqual([
      { type: 'text', content: 'Half an ans' },
      {
        type: 'tool_result',
        toolUseId,
        output: INTERRUPTED_TOOL_OUTPUT,
        isError: true,
      },
      { type: 'error', message: 'stream disconnected' },
    ]);
  });

  it('keeps partial agent text on a stream error event', () => {
    const messages = mapAll([
      {
        type: 'item.started',
        item: { id: 'msg-1', type: 'agent_message', text: 'Partial' },
      },
      { type: 'error', message: 'reconnect failed' },
    ]);
    expect(messages).toEqual([
      { type: 'text', content: 'Partial' },
      { type: 'error', message: 'reconnect failed' },
    ]);
  });

  it('flushes partial output on interrupt and is a no-op after a clean turn', () => {
    const interrupted = mapAll(
      [
        {
          type: 'item.updated',
          item: { id: 'msg-1', type: 'agent_message', text: 'So far' },
        },
      ],
      true,
    );
    expect(interrupted).toEqual([{ type: 'text', content: 'So far' }]);

    const clean = mapAll(
      [
        {
          type: 'item.updated',
          item: { id: 'msg-1', type: 'agent_message', text: 'Do' },
        },
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'Done.' },
        },
        { type: 'item.started', item: command('in_progress', '') },
        { type: 'item.completed', item: command('completed', 'ok', 0) },
      ],
      true,
    );
    expect(clean.filter((m) => m.type === 'text')).toEqual([
      { type: 'text', content: 'Done.' },
    ]);
    expect(clean.filter((m) => m.type === 'tool_result')).toHaveLength(1);
  });
});

describe('CodexAgent turn interruption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSubprocessMcpConfig.mockResolvedValue({
      codexConfig: {},
      denialHints: [],
      env: {},
      revoke: vi.fn(),
    });
  });

  it('emits partial text before the error when the event stream throws', async () => {
    mocks.startThread.mockReturnValue({
      runStreamed: vi.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'thread-1' };
          yield {
            type: 'item.updated',
            item: {
              id: 'msg-1',
              type: 'agent_message',
              text: 'Partial answer',
            },
          };
          throw new Error('The operation was aborted');
        })(),
      })),
    });

    const agent = new CodexAgent({ provider: 'codex' });
    const messages: AgentMessage[] = [];
    for await (const message of agent.run('hello', { taskId: 'task-1' })) {
      messages.push(message);
    }

    expect(messages.slice(-3)).toEqual([
      { type: 'text', content: 'Partial answer' },
      { type: 'error', message: 'The operation was aborted' },
      { type: 'done' },
    ]);
  });
});
