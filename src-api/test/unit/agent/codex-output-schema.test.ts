import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

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
    DEFAULT_WORK_DIR: '/tmp/neuma-codex-output-schema-test',
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

import type { AgentMessage } from '@/core/agent/types';

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
    runStreamed: vi.fn(async (_input: unknown, _turnOptions?: unknown) => ({
      events: eventStream(events),
    })),
  };
}

// A representative Zod schema a structured-output caller might hold, mirroring
// the pattern in shared/video/agent-sdk.ts (sdkPlanSchema + z.toJSONSchema()).
const weatherReportSchema = z.object({
  city: z.string(),
  temperatureC: z.number(),
});

describe('CodexAgent outputSchema wiring (#68)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSubprocessMcpConfig.mockResolvedValue(createBridge());
  });

  it('passes outputFormat.schema as runStreamed outputSchema in run()', async () => {
    const jsonSchema = z.toJSONSchema(weatherReportSchema) as Record<
      string,
      unknown
    >;
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-run' },
      {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: '{"city":"Paris","temperatureC":18}',
        },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages: AgentMessage[] = [];
    for await (const message of agent.run('what is the weather?', {
      taskId: 'task-run',
      outputFormat: { type: 'json_schema', schema: jsonSchema },
    })) {
      messages.push(message);
    }

    expect(thread.runStreamed).toHaveBeenCalledOnce();
    expect(thread.runStreamed.mock.calls[0]?.[1]).toMatchObject({
      outputSchema: jsonSchema,
    });
  });

  it('passes outputFormat.schema as runStreamed outputSchema in the conversational plan() path', async () => {
    const jsonSchema = z.toJSONSchema(weatherReportSchema) as Record<
      string,
      unknown
    >;
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-plan' },
      {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: '{"city":"Paris","temperatureC":18}',
        },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages: AgentMessage[] = [];
    // "hi" is classified conversational by isConversationalPrompt(), which
    // routes plan() straight into the runStreamed call this issue wires.
    for await (const message of agent.plan('hi', {
      taskId: 'task-plan',
      outputFormat: { type: 'json_schema', schema: jsonSchema },
    })) {
      messages.push(message);
    }

    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'direct_answer' }),
    );
    expect(thread.runStreamed).toHaveBeenCalledOnce();
    expect(thread.runStreamed.mock.calls[0]?.[1]).toMatchObject({
      outputSchema: jsonSchema,
    });
  });

  it('passes outputFormat.schema as runStreamed outputSchema in execute()', async () => {
    const jsonSchema = z.toJSONSchema(weatherReportSchema) as Record<
      string,
      unknown
    >;
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-execute' },
      {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: '{"city":"Paris","temperatureC":18}',
        },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages: AgentMessage[] = [];
    for await (const message of agent.execute({
      planId: 'plan-1',
      originalPrompt: 'what is the weather?',
      plan: {
        id: 'plan-1',
        goal: 'what is the weather?',
        steps: [],
        createdAt: new Date(),
      },
      taskId: 'task-execute',
      outputFormat: { type: 'json_schema', schema: jsonSchema },
    })) {
      messages.push(message);
    }

    expect(thread.runStreamed).toHaveBeenCalledOnce();
    expect(thread.runStreamed.mock.calls[0]?.[1]).toMatchObject({
      outputSchema: jsonSchema,
    });
  });

  it('omits outputSchema entirely when no outputFormat is requested', async () => {
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-no-schema' },
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'Done' },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages: AgentMessage[] = [];
    for await (const message of agent.run('hello', { taskId: 'task-none' })) {
      messages.push(message);
    }

    expect(thread.runStreamed).toHaveBeenCalledOnce();
    expect(thread.runStreamed.mock.calls[0]?.[1]).not.toHaveProperty(
      'outputSchema',
    );
  });
});

describe('Codex structured-output caller (#68)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSubprocessMcpConfig.mockResolvedValue(createBridge());
  });

  it('derives a JSON Schema from a Zod schema and parses the final agent message back into it', async () => {
    // Caller-side pattern: hold a Zod schema, derive JSON Schema with Zod 4's
    // toJSONSchema() (mirrors shared/video/agent-sdk.ts's sdkPlanSchema flow),
    // pass it through AgentOptions.outputFormat, then validate the model's
    // final text reply against the same Zod schema.
    const jsonSchema = z.toJSONSchema(weatherReportSchema) as Record<
      string,
      unknown
    >;
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-caller' },
      {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: '{"city":"Paris","temperatureC":18}',
        },
      },
      {
        type: 'turn.completed',
        usage: {
          cached_input_tokens: 0,
          input_tokens: 10,
          output_tokens: 5,
          reasoning_output_tokens: 0,
        },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages: AgentMessage[] = [];
    for await (const message of agent.run('what is the weather in Paris?', {
      taskId: 'task-caller',
      outputFormat: { type: 'json_schema', schema: jsonSchema },
    })) {
      messages.push(message);
    }

    // The turn options actually reached the SDK.
    expect(thread.runStreamed.mock.calls[0]?.[1]).toMatchObject({
      outputSchema: jsonSchema,
    });

    // The caller parses the final agent text message and validates it
    // against the same Zod schema it derived the JSON Schema from.
    const textMessages = messages.filter((m) => m.type === 'text');
    const finalMessage = textMessages.at(-1);
    expect(finalMessage?.content).toBeDefined();

    const parsed = weatherReportSchema.parse(
      JSON.parse(finalMessage!.content!),
    );
    expect(parsed).toEqual({ city: 'Paris', temperatureC: 18 });
  });
});
