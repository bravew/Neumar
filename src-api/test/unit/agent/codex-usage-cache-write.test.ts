import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regression test for issue #70 (F7): the Codex SDK's `Usage` type
// (@openai/codex-sdk 0.157.1) carries `cache_write_input_tokens`, which the
// adapter previously dropped on the floor. This asserts both surfaces that
// should now carry it: the streamed `result` AgentMessage (consumed by the
// frontend cost display) and the `logUsage` telemetry call.
const mocks = vi.hoisted(() => {
  const startThread = vi.fn();
  const resumeThread = vi.fn();
  const codexConstructor = vi.fn(function Codex() {
    return {
      startThread,
      resumeThread,
    };
  });

  return {
    codexConstructor,
    startThread,
    resumeThread,
    buildSubprocessMcpConfig: vi.fn(),
    logUsage: vi.fn(),
    resolveCodexBinaryPath: vi.fn(() => '/usr/local/bin/codex'),
  };
});

vi.mock('@openai/codex-sdk', () => ({
  Codex: mocks.codexConstructor,
}));

vi.mock('@/config/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/constants')>();
  return {
    ...actual,
    DEFAULT_API_HOST: '127.0.0.1',
    DEFAULT_API_PORT: 2620,
    DEFAULT_WORK_DIR: '/tmp/neuma-codex-agent-test',
  };
});

vi.mock('@/shared/mcp/subprocess-bridge', () => ({
  buildSubprocessMcpConfig: mocks.buildSubprocessMcpConfig,
}));

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: mocks.logUsage,
}));

vi.mock('@/shared/utils/codex-binary', () => ({
  getExtendedPath: vi.fn(() => '/usr/local/bin:/usr/bin:/bin'),
  resolveCodexBinaryPath: mocks.resolveCodexBinaryPath,
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { CodexAgent } from '@/extensions/agent/codex';

function createBridge() {
  return {
    codexConfig: {},
    denialHints: [],
    env: {},
    revoke: vi.fn(),
  };
}

function eventStream(events: unknown[]) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createThread(events: unknown[]) {
  return {
    runStreamed: vi.fn(async () => ({
      events: eventStream(events),
    })),
  };
}

describe('CodexAgent cache-write usage mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSubprocessMcpConfig.mockResolvedValue(createBridge());
  });

  it('maps cache_write_input_tokens onto the result usage and logUsage call', async () => {
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-cache-write' },
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'Done' },
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          cache_write_input_tokens: 45,
          output_tokens: 30,
          reasoning_output_tokens: 5,
        },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages = [];
    for await (const message of agent.run('hello', { taskId: 'task-cache' })) {
      messages.push(message);
    }

    const resultMessage = messages.find((message) => message.type === 'result');
    expect(resultMessage?.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 30,
      reasoning_output_tokens: 5,
      cache_creation_input_tokens: 45,
    });

    expect(mocks.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheReadTokens: 20,
        cacheCreationTokens: 45,
      }),
    );
  });

  it('omits cache_creation_input_tokens when the turn writes nothing to cache', async () => {
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-no-cache-write' },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 5,
          reasoning_output_tokens: 0,
        },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages = [];
    for await (const message of agent.run('hi', { taskId: 'task-no-cache' })) {
      messages.push(message);
    }

    const resultMessage = messages.find((message) => message.type === 'result');
    expect(resultMessage?.usage?.cache_creation_input_tokens).toBeUndefined();

    expect(mocks.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({ cacheCreationTokens: undefined }),
    );
  });
});
