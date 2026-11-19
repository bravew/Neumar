import { EventType, type BaseEvent } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../../../src/core/agent/types';
import { AGUIEmitter } from '../../../../src/shared/services/ag-ui/emitter';
import {
  RunUsageAccumulator,
  tokenUsageFromAgentUsage,
} from '../../../../src/shared/services/ag-ui/run-usage';

async function collect(
  messages: AgentMessage[],
  options: {
    fail?: Error;
    signal?: AbortSignal;
    planInterrupt?: boolean;
  } = {},
): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', 'run-1', {
    provider: 'anthropic',
    model: 'claude-x',
    signal: options.signal,
    planInterrupt: options.planInterrupt,
  });
  async function* source() {
    yield* messages;
    if (options.fail) throw options.fail;
  }
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(source())) events.push(event);
  return events;
}

type Terminal = BaseEvent & {
  usage?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  outcome?: { type: string };
};

const terminal = (events: BaseEvent[]): Terminal =>
  events.find(
    (event) =>
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR,
  ) as Terminal;

describe('tokenUsageFromAgentUsage', () => {
  it('adds cache subsets into the input total when the provider excludes them', () => {
    expect(
      tokenUsageFromAgentUsage(
        {
          input_tokens: 10,
          output_tokens: 5,
          reasoning_output_tokens: 2,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20,
          input_includes_cache: false,
        },
        { provider: 'anthropic', model: 'm' },
      ),
    ).toEqual({
      provider: 'anthropic',
      model: 'm',
      inputTokens: 130,
      outputTokens: 5,
      totalTokens: 135,
      reasoningTokens: 2,
      cachedInputTokens: 100,
      cacheWriteInputTokens: 20,
    });
  });

  it('does not add cache again when the provider input already includes it', () => {
    expect(
      tokenUsageFromAgentUsage(
        {
          input_tokens: 130,
          output_tokens: 5,
          cache_read_input_tokens: 100,
          input_includes_cache: true,
        },
        {},
      ),
    ).toMatchObject({
      inputTokens: 130,
      cachedInputTokens: 100,
      totalTokens: 135,
    });
  });

  it('keeps unreported counts absent, an explicit zero as zero, and never invents totals', () => {
    const usage = tokenUsageFromAgentUsage(
      { output_tokens: 0 },
      { provider: 'p' },
    );
    expect(usage).toEqual({ provider: 'p', outputTokens: 0 });
    expect(usage).not.toHaveProperty('inputTokens');
    expect(usage).not.toHaveProperty('totalTokens');
  });

  it('omits cache counts when the provider convention is unknown', () => {
    const usage = tokenUsageFromAgentUsage(
      { input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 5 },
      {},
    );
    expect(usage).toEqual({ inputTokens: 7, outputTokens: 1, totalTokens: 8 });
  });

  it('returns undefined when the provider reported nothing usable', () => {
    expect(tokenUsageFromAgentUsage(undefined, {})).toBeUndefined();
    expect(tokenUsageFromAgentUsage({}, {})).toBeUndefined();
    expect(
      tokenUsageFromAgentUsage({ input_tokens: Number.NaN }, {}),
    ).toBeUndefined();
  });
});

describe('RunUsageAccumulator', () => {
  it('sums several calls per provider/model and keeps models separate', () => {
    const acc = new RunUsageAccumulator({ provider: 'openai', model: 'a' });
    acc.record({
      type: 'result',
      usage: { input_tokens: 10, output_tokens: 1 },
    });
    acc.record({
      type: 'result',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    acc.record({
      type: 'result',
      model: 'b',
      usage: { input_tokens: 3, output_tokens: 3 },
    });
    expect(acc.tokenUsage).toEqual([
      expect.objectContaining({ model: 'a', inputTokens: 15, outputTokens: 3 }),
      expect.objectContaining({ model: 'b', inputTokens: 3, outputTokens: 3 }),
    ]);
  });

  it('ignores sub-agent-owned messages so the parent total is not double counted', () => {
    const acc = new RunUsageAccumulator({});
    acc.record({ type: 'result', usage: { input_tokens: 10 } });
    acc.record({
      type: 'result',
      subagentRunId: 'child',
      usage: { input_tokens: 999 },
    });
    expect(acc.tokenUsage?.[0]?.inputTokens).toBe(10);
  });

  it('reports spend only when a producer reported it, and prefers the per-call delta', () => {
    const acc = new RunUsageAccumulator({});
    acc.record({ type: 'result', usage: { input_tokens: 1 } });
    expect(acc.costUsd).toBeUndefined();
    acc.record({ type: 'result', cost: 9, costDelta: 0.25 });
    acc.record({ type: 'result', cost: 0 });
    expect(acc.costUsd).toBe(0.25);
  });

  it('adds per-call costs for a producer that reports no delta', () => {
    const acc = new RunUsageAccumulator({});
    acc.record({ type: 'result', cost: 0.2 });
    acc.record({ type: 'result', cost: 0.3 });
    // There is no session total to prefer; the last call would understate it.
    expect(acc.projection?.cost).toBeCloseTo(0.5);
    expect(acc.costUsd).toBeCloseTo(0.5);
  });

  it('prefers the reported session total when the producer reports deltas', () => {
    const acc = new RunUsageAccumulator({});
    acc.record({ type: 'result', cost: 7, costDelta: 0.5 });
    acc.record({ type: 'result', cost: 8, costDelta: 1 });
    // The task row takes the session total; the run's own spend is the delta.
    expect(acc.projection?.cost).toBe(8);
    expect(acc.costUsd).toBeCloseTo(1.5);
  });
});

describe('AG-UI terminal usage', () => {
  it('attaches the run usage to RUN_FINISHED on success', async () => {
    const events = await collect([
      { type: 'text', content: 'hi' },
      {
        type: 'result',
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          input_includes_cache: false,
        },
        costDelta: 0.5,
        cost: 7,
      },
    ]);
    const end = terminal(events);
    expect(end.type).toBe(EventType.RUN_FINISHED);
    expect(end.usage).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-x',
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
    ]);
    expect(end.metadata).toMatchObject({ costUsd: 0.5 });
  });

  it('omits usage and cost entirely when nothing was reported', async () => {
    const end = terminal(await collect([{ type: 'text', content: 'hi' }]));
    expect(end).not.toHaveProperty('usage');
    expect(end.metadata?.costUsd).toBeUndefined();
  });

  it('keeps partial spend on RUN_ERROR from a thrown failure', async () => {
    const end = terminal(
      await collect(
        [{ type: 'result', usage: { input_tokens: 3, output_tokens: 1 } }],
        { fail: new Error('upstream died') },
      ),
    );
    expect(end.type).toBe(EventType.RUN_ERROR);
    expect(end.usage?.[0]).toMatchObject({ inputTokens: 3, outputTokens: 1 });
  });

  it('keeps partial spend on RUN_ERROR from an error message', async () => {
    const end = terminal(
      await collect([
        { type: 'result', usage: { input_tokens: 3 } },
        { type: 'error', message: 'boom' },
      ]),
    );
    expect(end.type).toBe(EventType.RUN_ERROR);
    expect(end.usage?.[0]).toMatchObject({ inputTokens: 3 });
  });

  it('does not fabricate usage for a provider that failed before reporting any', async () => {
    const end = terminal(await collect([{ type: 'error', message: 'boom' }]));
    expect(end).not.toHaveProperty('usage');
    expect(end.metadata?.costUsd).toBeUndefined();
  });

  it('keeps the planning spend on an INVALID_PLAN failure', async () => {
    const end = terminal(
      await collect(
        [
          {
            type: 'plan',
            plan: { id: '', goal: 'g', steps: [], createdAt: new Date(0) },
            usage: { input_tokens: 5 },
          },
        ],
        { planInterrupt: true },
      ),
    );
    expect(end.type).toBe(EventType.RUN_ERROR);
    expect(end).toMatchObject({ code: 'INVALID_PLAN' });
    expect(end.usage?.[0]).toMatchObject({ inputTokens: 5 });
  });

  it('reports usage on a cancelled run', async () => {
    const controller = new AbortController();
    controller.abort();
    const end = terminal(
      await collect([{ type: 'result', usage: { output_tokens: 2 } }], {
        fail: new DOMException('stop', 'AbortError'),
        signal: controller.signal,
      }),
    );
    expect(end.type).toBe(EventType.RUN_FINISHED);
    expect(end.outcome?.type).toBe('cancelled');
    expect(end.usage?.[0]).toMatchObject({ outputTokens: 2 });
  });

  it('does not emit fabricated zeros in state snapshots', async () => {
    const emitter = new AGUIEmitter('thread-1', 'run-1', {
      workspaceRoot: '/ws',
    });
    async function* source(): AsyncGenerator<AgentMessage> {
      yield { type: 'result', usage: { input_tokens: 4 } };
    }
    const snapshots: Array<Record<string, unknown>> = [];
    for await (const event of emitter.transform(source())) {
      if (event.type === EventType.STATE_SNAPSHOT) {
        snapshots.push(
          (event as BaseEvent & { snapshot: Record<string, unknown> }).snapshot,
        );
      }
    }
    expect(snapshots[0]).not.toHaveProperty('usage');
    expect(snapshots[1]?.usage).toEqual({ inputTokens: 4 });
  });
});
