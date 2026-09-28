import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db', () => ({
  getDatabase: vi.fn(() => {
    throw new Error('no db in unit tests');
  }),
}));

import {
  CLAUDE_STREAM_SIGNAL_ENV,
  lookupPersistedCumulativeCost,
  mapClaudeStreamSignals,
  observeClaudeStepUsage,
  resetClaudeStreamSignalState,
  settleClaudeResultUsage,
} from '@/extensions/agent/claude/stream-signals';

import { getClaudePluginHealth } from '@/shared/plugins/claude-plugin-health';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { CustomEventName } from '@/shared/services/ag-ui/event-schema';

import { defined } from '../../../../helpers/defined';

// Recorded SDK 0.3.283 message shapes (uuid/session_id trimmed where unused).
const SESSION = 'sdk-session-1';

const informational = {
  type: 'system',
  subtype: 'informational',
  content: 'UserPromptSubmit hook blocked: secrets detected',
  level: 'warning',
  prevent_continuation: true,
  uuid: 'u-1',
  session_id: SESSION,
};

const apiRetry = {
  type: 'system',
  subtype: 'api_retry',
  attempt: 2,
  max_retries: 10,
  retry_delay_ms: 4000,
  error_status: 529,
  error: 'overloaded',
  uuid: 'u-2',
  session_id: SESSION,
};

const rateLimitRejected = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'rejected',
    resetsAt: 1_900_000_000,
    rateLimitType: 'five_hour',
    utilization: 1,
  },
  uuid: 'u-3',
  session_id: SESSION,
};

const initWithPluginErrors = {
  type: 'system',
  subtype: 'init',
  session_id: SESSION,
  plugins: [],
  plugin_errors: [
    {
      plugin: 'lint-tools@acme',
      type: 'dependency-unsatisfied',
      message: 'requires base-tools@acme',
    },
  ],
};

const sessionState = {
  type: 'system',
  subtype: 'session_state_changed',
  state: 'requires_action',
  uuid: 'u-4',
  session_id: SESSION,
};

const conversationReset = {
  type: 'conversation_reset',
  new_conversation_id: '5f0c3c2e-7c1d-4b4e-9a53-0d6f3b0f9a11',
  trigger: 'clear',
  uuid: 'u-5',
  session_id: SESSION,
};

const mcpToolResultWithLinks = {
  type: 'user',
  parent_tool_use_id: null,
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_01',
        content: 'Rendered 1 file',
      },
    ],
  },
  tool_use_result: {
    resourceLinks: [
      {
        uri: 'file:///tmp/out/report.pdf',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: 2048,
      },
      { uri: 'not a link' },
    ],
  },
  session_id: SESSION,
};

const startupFailure = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
  modelUsage: {},
  errors: ['Error: working directory does not exist'],
  startup_failure_reason: 'cwd_unavailable',
  session_id: SESSION,
};

describe('mapClaudeStreamSignals', () => {
  beforeEach(() => resetClaudeStreamSignalState());

  it('maps system/informational to a notice signal', () => {
    const [msg] = mapClaudeStreamSignals(informational);
    expect(msg).toMatchObject({
      type: 'system',
      subtype: 'notice',
      content: informational.content,
      isProgress: false,
      streamSignal: {
        kind: 'notice',
        level: 'warning',
        content: informational.content,
        preventContinuation: true,
      },
    });
  });

  it('keeps info-level notices out of conversation history', () => {
    const [msg] = mapClaudeStreamSignals({ ...informational, level: 'info' });
    expect(defined(msg).isProgress).toBe(true);
  });

  it('maps api_retry to a structured retry signal', () => {
    expect(defined(mapClaudeStreamSignals(apiRetry)[0]).streamSignal).toEqual({
      kind: 'api_retry',
      attempt: 2,
      maxRetries: 10,
      retryDelayMs: 4000,
      errorStatus: 529,
      error: 'overloaded',
    });
  });

  it('maps a rejected rate_limit_event with resetsAt in ms', () => {
    expect(
      defined(mapClaudeStreamSignals(rateLimitRejected)[0]).streamSignal,
    ).toEqual({
      kind: 'rate_limit',
      status: 'rejected',
      resetsAt: 1_900_000_000_000,
      utilization: 1,
      rateLimitType: 'five_hour',
    });
  });

  it('ignores an allowed rate_limit_event', () => {
    expect(
      mapClaudeStreamSignals({
        ...rateLimitRejected,
        rate_limit_info: { status: 'allowed' },
      }),
    ).toEqual([]);
  });

  it('records init plugin_errors in plugin health and emits a signal', () => {
    const [msg] = mapClaudeStreamSignals(initWithPluginErrors);
    expect(defined(msg).streamSignal).toEqual({
      kind: 'plugin_errors',
      errors: initWithPluginErrors.plugin_errors,
    });
    const health = getClaudePluginHealth();
    expect(health.checkedAt).not.toBeNull();
    expect(health.errors).toEqual(initWithPluginErrors.plugin_errors);

    // The key is omitted on a clean load — health clears, no signal.
    const { plugin_errors: _omit, ...cleanInit } = initWithPluginErrors;
    expect(mapClaudeStreamSignals(cleanInit)).toEqual([]);
    expect(getClaudePluginHealth().errors).toEqual([]);
  });

  it('maps session_state_changed and conversation_reset', () => {
    expect(
      defined(mapClaudeStreamSignals(sessionState)[0]).streamSignal,
    ).toEqual({
      kind: 'session_state',
      state: 'requires_action',
    });
    expect(
      defined(mapClaudeStreamSignals(conversationReset)[0]).streamSignal,
    ).toEqual({
      kind: 'conversation_reset',
      newConversationId: conversationReset.new_conversation_id,
      trigger: 'clear',
    });
  });

  it('maps tool_use_result.resourceLinks without parsing result text', () => {
    expect(
      defined(mapClaudeStreamSignals(mcpToolResultWithLinks)[0]).streamSignal,
    ).toEqual({
      kind: 'resource_links',
      toolUseId: 'toolu_01',
      links: [
        {
          uri: 'file:///tmp/out/report.pdf',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: 2048,
        },
      ],
    });
  });

  it('maps backgrounded MCP task resource_links', () => {
    const [msg] = mapClaudeStreamSignals({
      type: 'system',
      subtype: 'task_notification',
      task_id: 't1',
      tool_use_id: 'toolu_02',
      status: 'completed',
      resource_links: [{ uri: 'https://example.com/a.png', name: 'a.png' }],
    });
    const backgrounded = defined(msg, 'backgrounded notice');
    expect(backgrounded.streamSignal).toEqual({
      kind: 'resource_links',
      toolUseId: 'toolu_02',
      links: [{ uri: 'https://example.com/a.png', name: 'a.png' }],
    });
  });

  it('turns startup_failure_reason into an actionable error', () => {
    const msg = defined(mapClaudeStreamSignals(startupFailure)[0], 'msg');
    expect(msg.type).toBe('error');
    expect(msg.subtype).toBe('startup_failure');
    expect(msg.code).toBe('cwd_unavailable');
    expect(msg.message).toMatch(/Choose another folder/);
  });

  it('falls back to SDK error text for an unknown startup reason', () => {
    const [msg] = mapClaudeStreamSignals({
      ...startupFailure,
      startup_failure_reason: 'something_new',
    });
    expect(defined(msg).message).toBe(
      'Error: working directory does not exist',
    );
  });

  it('ignores unrelated messages', () => {
    expect(mapClaudeStreamSignals({ type: 'assistant' })).toEqual([]);
    expect(
      mapClaudeStreamSignals({
        ...startupFailure,
        startup_failure_reason: undefined,
      }),
    ).toEqual([]);
    expect(mapClaudeStreamSignals(null)).toEqual([]);
  });

  it('opts into session state events', () => {
    expect(CLAUDE_STREAM_SIGNAL_ENV).toEqual({
      CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
    });
  });
});

function assistant(id: string, input: number, parent: string | null = null) {
  return {
    type: 'assistant',
    parent_tool_use_id: parent,
    message: {
      id,
      usage: {
        input_tokens: input,
        output_tokens: 1,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
      content: [],
    },
    session_id: SESSION,
  };
}

function result(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.5,
    usage: {
      input_tokens: 300,
      output_tokens: 40,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    },
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 300,
        outputTokens: 40,
        thinkingTokens: 12,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 10,
        webSearchRequests: 0,
        costUSD: 0.5,
        contextWindow: 200000,
        maxOutputTokens: 32000,
        costBasis: 'managed',
      },
    },
    result_index: 0,
    queued_turn_count: 0,
    session_id: SESSION,
    ...overrides,
  };
}

describe('settleClaudeResultUsage', () => {
  beforeEach(() => resetClaudeStreamSignalState());

  const noPersisted = () => undefined;

  it('reads modelUsage thinking tokens, cost basis, result_index and queued_turn_count', () => {
    const t = settleClaudeResultUsage(
      'run-1',
      result({ result_index: 3, queued_turn_count: 1 }),
      noPersisted,
    );
    expect(t.billableCostUsd).toBe(0.5);
    expect(t.resultIndex).toBe(3);
    expect(t.queuedTurnCount).toBe(1);
    expect(t.metadata).toMatchObject({
      sdk_session_id: SESSION,
      sdk_cumulative_cost_usd: 0.5,
      model_thinking_tokens: 12,
      result_index: 3,
      queued_turn_count: 1,
      model_usage: {
        'claude-opus-4-7': {
          cost_usd: 0.5,
          thinking_tokens: 12,
          cost_basis: 'managed',
        },
      },
    });
  });

  it('treats an absent costBasis as list price', () => {
    const r = result();
    const mu = defined(
      (r.modelUsage as Record<string, Record<string, unknown>>)[
        'claude-opus-4-7'
      ],
      'model usage',
    );
    delete mu.costBasis;
    const t = settleClaudeResultUsage('run-1', r, noPersisted);
    expect(t.metadata.model_usage).toMatchObject({
      'claude-opus-4-7': { cost_basis: 'list' },
    });
  });

  it('logs only the delta when a resumed session restores earlier spend', () => {
    const first = settleClaudeResultUsage('run-1', result(), noPersisted);
    expect(first.billableCostUsd).toBe(0.5);
    // Resumed query(): the SDK (>=0.3.277) continues from the saved $0.50.
    const resumed = settleClaudeResultUsage(
      'run-2',
      result({ total_cost_usd: 0.8 }),
      noPersisted,
    );
    expect(resumed.billableCostUsd).toBeCloseTo(0.3);
    expect(resumed.cumulativeCostUsd).toBe(0.8);
  });

  it('does not reuse another task in-memory cost baseline', () => {
    settleClaudeResultUsage(
      'run-a',
      result({ total_cost_usd: 1 }),
      noPersisted,
      'task-a',
    );
    const other = settleClaudeResultUsage(
      'run-b',
      result({ total_cost_usd: 1 }),
      noPersisted,
      'task-b',
    );
    expect(other.billableCostUsd).toBe(1);
  });

  it('uses the persisted cumulative cost after an app restart', () => {
    const lookup = vi.fn(() => 0.5);
    const t = settleClaudeResultUsage(
      'run-3',
      result({ total_cost_usd: 0.75 }),
      lookup,
    );
    expect(lookup).toHaveBeenCalledWith(SESSION, undefined);
    expect(t.billableCostUsd).toBeCloseTo(0.25);
  });

  it('counts the whole total when the SDK started over below the baseline', () => {
    settleClaudeResultUsage(
      'run-1',
      result({ total_cost_usd: 0.9 }),
      noPersisted,
    );
    const t = settleClaudeResultUsage(
      'run-2',
      result({ total_cost_usd: 0.2 }),
      noPersisted,
    );
    expect(t.billableCostUsd).toBe(0.2);
  });

  it('dedupes per-step usage by message ID for a zeroed crash result', () => {
    observeClaudeStepUsage('run-1', assistant('msg_a', 100));
    // Parallel tool calls: same message id, identical usage — count once.
    observeClaudeStepUsage('run-1', assistant('msg_a', 100));
    observeClaudeStepUsage('run-1', assistant('msg_b', 50));
    // Subagent steps are excluded.
    observeClaudeStepUsage('run-1', assistant('msg_c', 999, 'toolu_task'));

    const t = settleClaudeResultUsage(
      'run-1',
      result({
        subtype: 'error_during_execution',
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        modelUsage: {},
      }),
      noPersisted,
    );
    expect(t.inputTokens).toBe(150);
    expect(t.cacheReadTokens).toBe(20);
    expect(t.cacheCreationTokens).toBe(10);
    expect(t.metadata).toMatchObject({
      api_steps: 2,
      usage_source: 'deduped_steps',
    });
    expect(t.metadata.sdk_session_id).toBeUndefined();
    expect(t.metadata.sdk_cumulative_cost_usd).toBeUndefined();
  });

  it('keeps the baseline across a zeroed crash result', () => {
    settleClaudeResultUsage(
      'run-1',
      result({ total_cost_usd: 0.5 }),
      noPersisted,
    );
    settleClaudeResultUsage(
      'run-2',
      result({
        subtype: 'error_during_execution',
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      noPersisted,
    );
    const t = settleClaudeResultUsage(
      'run-3',
      result({ total_cost_usd: 0.6 }),
      noPersisted,
    );
    expect(t.billableCostUsd).toBeCloseTo(0.1);
  });

  it('uses result usage (not steps) on a normal result', () => {
    observeClaudeStepUsage('run-1', assistant('msg_a', 100));
    const t = settleClaudeResultUsage('run-1', result(), noPersisted);
    expect(t.inputTokens).toBe(300);
    expect(t.metadata.usage_source).toBeUndefined();
  });

  it('returns undefined from the persisted lookup when the DB is unavailable', () => {
    expect(lookupPersistedCumulativeCost(SESSION)).toBeUndefined();
  });
});

describe('AGUIEmitter stream signals', () => {
  it('forwards streamSignal as a neuma.stream_signal CUSTOM event', async () => {
    const notice = defined(mapClaudeStreamSignals(apiRetry)[0], 'notice');
    const emitter = new AGUIEmitter('thread-1', 'run-1');
    async function* source() {
      yield notice;
    }
    const events: Array<{ type: string; name?: string; value?: unknown }> = [];
    for await (const e of emitter.transform(source())) {
      events.push(e as { type: string; name?: string; value?: unknown });
    }
    const custom = events.find((e) => e.name === CustomEventName.StreamSignal);
    expect(custom?.type).toBe('CUSTOM');
    expect(custom?.value).toEqual(notice.streamSignal);
  });
});
