import { describe, expect, it, vi, beforeEach } from 'vitest';

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

describe('CodexAgent session resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSubprocessMcpConfig.mockResolvedValue(createBridge());
  });

  it('emits the Codex thread id as a durable resume handle', async () => {
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-123' },
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'Done' },
      },
      {
        type: 'turn.completed',
        usage: {
          cached_input_tokens: 7,
          input_tokens: 11,
          output_tokens: 3,
          reasoning_output_tokens: 0,
        },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages = [];
    for await (const message of agent.run('hello', { taskId: 'task-1' })) {
      messages.push(message);
    }

    const sessionMessages = messages.filter(
      (message) => message.type === 'session',
    );
    expect(sessionMessages).toHaveLength(2);
    expect(sessionMessages[1]).toMatchObject({
      sessionId: sessionMessages[0]?.sessionId,
      resumeSessionId: 'codex-thread-123',
    });
    expect(mocks.startThread).toHaveBeenCalledOnce();
    expect(mocks.resumeThread).not.toHaveBeenCalled();
  });

  it('resumes an existing Codex thread without replaying conversation history', async () => {
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-existing' },
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'Resumed' },
      },
    ]);
    mocks.resumeThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages = [];
    for await (const message of agent.run('continue', {
      conversation: [{ role: 'assistant', content: 'old answer' }],
      resumeSessionId: 'codex-thread-existing',
      taskId: 'task-2',
    })) {
      messages.push(message);
    }

    expect(mocks.resumeThread).toHaveBeenCalledWith(
      'codex-thread-existing',
      expect.objectContaining({ skipGitRepoCheck: true }),
    );
    expect(mocks.startThread).not.toHaveBeenCalled();
    expect(thread.runStreamed).toHaveBeenCalledOnce();
    expect(thread.runStreamed.mock.calls[0]?.[0]).not.toContain(
      '## Previous Conversation Context',
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'session',
        resumeSessionId: 'codex-thread-existing',
      }),
    );
  });
});
