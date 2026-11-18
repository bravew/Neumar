import { aggregateTokenUsage, type TokenUsage } from '@ag-ui/core';
import { z } from 'zod';

import type { AgentMessage } from '@/core/agent/types';

/** Who a run's calls are billed to when the call itself does not say. */
export interface RunUsageIdentity {
  provider?: string;
  model?: string;
}

type AgentUsage = NonNullable<AgentMessage['usage']>;

function count(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Map one provider call's usage to an AG-UI {@link TokenUsage}.
 *
 * AG-UI input and output are totals; cache-read, cache-write and reasoning are
 * subsets of them. A provider that reports the cache beside a smaller input
 * (`input_includes_cache === false`) has it added into the total; one that
 * already includes it is not added again. With the convention unknown the cache
 * counts are left out rather than guessed. A count the provider did not report
 * stays absent, and an explicit zero stays zero.
 */
export function tokenUsageFromAgentUsage(
  usage: AgentUsage | undefined,
  identity: RunUsageIdentity,
): TokenUsage | undefined {
  if (!usage) return undefined;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const reasoning = count(usage.reasoning_output_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const includes = usage.input_includes_cache;

  const reportsCache = includes !== undefined;
  const inputTokens =
    input !== undefined && includes === false
      ? input + (cacheRead ?? 0) + (cacheWrite ?? 0)
      : input;

  const entry: TokenUsage = {
    ...(identity.provider ? { provider: identity.provider } : {}),
    ...(identity.model ? { model: identity.model } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(inputTokens !== undefined && output !== undefined
      ? { totalTokens: inputTokens + output }
      : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
    ...(reportsCache && cacheRead !== undefined
      ? { cachedInputTokens: cacheRead }
      : {}),
    ...(reportsCache && cacheWrite !== undefined
      ? { cacheWriteInputTokens: cacheWrite }
      : {}),
  };
  const hasCount = Object.keys(entry).some(
    (key) => key !== 'provider' && key !== 'model',
  );
  return hasCount ? entry : undefined;
}

/**
 * Totals for one run. A run is the accounting boundary: it counts the calls it
 * made itself. Messages owned by a sub-agent are skipped, because the parent's
 * own report already covers them, and a resumed or retried run gets a fresh
 * accumulator so it never repeats the earlier run's calls.
 */
export class RunUsageAccumulator {
  private readonly calls: TokenUsage[] = [];
  private spend: number | undefined;
  /** The producer's own `cost` as last reported: a session total for some. */
  private reportedCost: number | undefined;

  constructor(private readonly identity: RunUsageIdentity) {}

  record(msg: AgentMessage): void {
    if (msg.subagentRunId) return;
    const entry = tokenUsageFromAgentUsage(msg.usage, {
      provider: this.identity.provider,
      model: msg.model ?? this.identity.model,
    });
    if (entry) this.calls.push(entry);
    const cost = count(msg.costDelta ?? msg.cost);
    if (cost !== undefined) this.spend = (this.spend ?? 0) + cost;
    const reported = count(msg.cost);
    if (reported !== undefined) this.reportedCost = reported;
  }

  /** One entry per provider and model; undefined when nothing was reported. */
  get tokenUsage(): TokenUsage[] | undefined {
    return this.calls.length > 0 ? aggregateTokenUsage(this.calls) : undefined;
  }

  /** Dollars the producers reported for this run; undefined when none did. */
  get costUsd(): number | undefined {
    return this.spend;
  }

  /**
   * Run-so-far projection for the legacy `STATE_SNAPSHOT.usage` consumers.
   * Its `cost` is the producer's reported total, not this run's delta: the task
   * row overwrites its cost with it, and a resumed task's total includes
   * earlier runs. The run's own spend is `costUsd`.
   */
  get projection():
    | { inputTokens?: number; outputTokens?: number; cost?: number }
    | undefined {
    const entries = this.tokenUsage;
    const cost = this.reportedCost ?? this.spend;
    if (!entries && cost === undefined) return undefined;
    const sum = (pick: (entry: TokenUsage) => number | undefined) =>
      sumRunTokens(entries, pick);
    const inputTokens = sum((entry) => entry.inputTokens);
    const outputTokens = sum((entry) => entry.outputTokens);
    return {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(cost !== undefined ? { cost } : {}),
    };
  }
}

const tokenCount = z.number().finite().nonnegative().optional();

const TokenUsageSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  totalTokens: tokenCount,
  reasoningTokens: tokenCount,
  cachedInputTokens: tokenCount,
  cacheWriteInputTokens: tokenCount,
});

/**
 * What a run reported on its terminal event, in the form `agent_runs.usage_json`
 * stores. An absent field means the producer did not report it.
 */
export const RunUsageRecordSchema = z.object({
  usage: z.array(TokenUsageSchema).optional(),
  costUsd: z.number().finite().nonnegative().optional(),
});

export type RunUsageRecord = z.infer<typeof RunUsageRecordSchema>;

/** Read the usage a terminal event carries; undefined when it reports none. */
export function runUsageFromTerminalEvent(event: {
  usage?: unknown;
  metadata?: unknown;
}): RunUsageRecord | undefined {
  const metadata =
    event.metadata && typeof event.metadata === 'object'
      ? (event.metadata as { costUsd?: unknown })
      : undefined;
  const parsed = RunUsageRecordSchema.safeParse({
    usage: event.usage,
    costUsd: metadata?.costUsd,
  });
  if (!parsed.success) return undefined;
  const { usage, costUsd } = parsed.data;
  if (!usage?.length && costUsd === undefined) return undefined;
  return parsed.data;
}

/** A stored record that no longer parses is unknown, never an empty run. */
export function parseRunUsageRecord(
  json: string | null | undefined,
): RunUsageRecord | undefined {
  if (!json) return undefined;
  try {
    const parsed = RunUsageRecordSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Sum one count across a run's entries; undefined when none reported it. */
export function sumRunTokens(
  usage: TokenUsage[] | undefined,
  pick: (entry: TokenUsage) => number | undefined,
): number | undefined {
  const values = (usage ?? [])
    .map(pick)
    .filter((value): value is number => value !== undefined);
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0)
    : undefined;
}
