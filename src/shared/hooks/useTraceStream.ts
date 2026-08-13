/**
 * useTraceStream — Builds trace entries from agent messages for timeline visualization.
 *
 * Consumes either legacy AgentMessage[] (with startedAt/parentId) or
 * AGUIMessage[] and produces a flat TraceEntry[] with running duration
 * computation for active operations.
 */
import { useEffect, useMemo, useState } from 'react';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import type { AgentMessage } from '@/shared/hooks/agent-types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TraceEntry {
  id: string;
  type: 'llm' | 'tool' | 'thinking' | 'user' | 'error' | 'plan';
  name: string;
  startedAt: number; // epoch ms
  duration?: number; // ms, undefined while running
  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
  };
  cost?: number;
  model?: string;
  status: 'running' | 'completed' | 'error';
  parentId?: string;
  content?: string;
  /** Serialized tool input arguments */
  toolInput?: string;
  /** Tool result output (populated when tool_result arrives) */
  toolOutput?: string;
}

export interface TraceSummary {
  totalDuration: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  totalCost: number;
  operationCount: number;
  byType: Record<string, number>;
}

// ── Type guards ──────────────────────────────────────────────────────────────

function isAgentMessage(msg: unknown): msg is AgentMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as AgentMessage).type === 'string'
  );
}

function isAGUIMessage(msg: unknown): msg is AGUIMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'role' in msg &&
    typeof (msg as AGUIMessage).role === 'string'
  );
}

// ── Entry builders ───────────────────────────────────────────────────────────

const MSG_TYPE_MAP: Record<string, TraceEntry['type']> = {
  text: 'llm',
  tool_use: 'tool',
  tool_result: 'tool',
  thinking: 'thinking',
  planning_status: 'thinking',
  user: 'user',
  error: 'error',
  plan: 'plan',
  result: 'llm',
  done: 'llm',
};

/**
 * Serialize tool input to a human-readable string (truncated).
 * Shows JSON for objects, raw string otherwise.
 */
function serializeToolInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  const str =
    typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  return str.length > 2000 ? str.slice(0, 2000) + '…' : str;
}

/**
 * Builds a trace entry from an AgentMessage.
 *
 * For tool_result messages, instead of creating a new entry, returns a marker
 * object that the caller uses to update the parent tool_use entry with output.
 */
function buildFromAgentMessage(
  msg: AgentMessage,
  index: number,
  now: number,
  openSpans: Map<string, number>,
  entryMap: Map<string, TraceEntry>,
): TraceEntry | null {
  const traceType = MSG_TYPE_MAP[msg.type] ?? 'llm';

  // Skip session/done/direct_answer — not useful in trace
  if (
    msg.type === 'session' ||
    msg.type === 'done' ||
    msg.type === 'direct_answer'
  ) {
    return null;
  }

  const startedAt = msg.startedAt ? new Date(msg.startedAt).getTime() : now;
  const entryId = msg.id ?? `trace-${index}`;

  // Track open tool_use spans
  if (msg.type === 'tool_use' && msg.id) {
    openSpans.set(msg.id, startedAt);
  }

  // tool_result: close the open span and enrich the parent entry with output
  if (msg.type === 'tool_result' && msg.parentId) {
    const parentStartedAt = openSpans.get(msg.parentId);
    openSpans.delete(msg.parentId);

    const parentEntry = entryMap.get(msg.parentId);
    if (parentEntry) {
      const resultTimestamp = msg.startedAt
        ? new Date(msg.startedAt).getTime()
        : now;
      parentEntry.duration =
        parentStartedAt != null
          ? resultTimestamp - parentStartedAt
          : parentEntry.duration;
      parentEntry.status = msg.isError ? 'error' : 'completed';

      // Attach output (truncated for display)
      const output = msg.output ?? msg.content;
      if (output) {
        parentEntry.toolOutput =
          output.length > 2000 ? output.slice(0, 2000) + '…' : output;
      }
    }
    return null;
  }

  const duration = msg.duration;
  const isRunning =
    msg.type === 'tool_use' && msg.id ? openSpans.has(msg.id) : false;

  const entry: TraceEntry = {
    id: entryId,
    type: traceType,
    name: msg.name ?? msg.type,
    startedAt,
    duration: isRunning ? now - startedAt : duration,
    tokens: msg.usage
      ? {
          input: msg.usage.input_tokens ?? 0,
          output: msg.usage.output_tokens ?? 0,
          cacheRead: msg.usage.cache_read_input_tokens,
          cacheCreation: msg.usage.cache_creation_input_tokens,
        }
      : undefined,
    cost: msg.cost,
    model: msg.model,
    status: msg.isError ? 'error' : isRunning ? 'running' : 'completed',
    parentId: msg.parentId,
    content: msg.content ?? msg.output,
    toolInput:
      msg.type === 'tool_use' ? serializeToolInput(msg.input) : undefined,
  };

  if (msg.type === 'tool_use' && msg.id) {
    entryMap.set(msg.id, entry);
  }

  return entry;
}

function buildFromAGUIMessage(
  msg: AGUIMessage,
  index: number,
  now: number,
): TraceEntry | null {
  if (msg.role === 'tool') return null; // Tool results handled by tool_use group

  const isUser = msg.role === 'user';
  const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;

  if (isUser) {
    return {
      id: msg.id,
      type: 'user',
      name: 'user',
      startedAt: now - (index + 1) * 100, // approximate ordering
      status: 'completed',
      content: msg.content,
    };
  }

  // Assistant message with tool calls
  if (hasToolCalls) {
    const toolName =
      msg.toolCalls?.[0]?.function?.name ?? msg.toolCalls?.[0]?.name ?? 'tool';
    return {
      id: msg.id,
      type: 'tool',
      name: `${toolName}${(msg.toolCalls?.length ?? 0) > 1 ? ` (+${(msg.toolCalls?.length ?? 0) - 1})` : ''}`,
      startedAt: now - (index + 1) * 100,
      status: 'completed',
      content: msg.content,
    };
  }

  // Plain assistant text
  if (msg.content) {
    return {
      id: msg.id,
      type: 'llm',
      name: 'assistant',
      startedAt: now - (index + 1) * 100,
      status: 'completed',
      content: msg.content?.slice(0, 200),
    };
  }

  return null;
}

// ── Main hook ────────────────────────────────────────────────────────────────

export function useTraceStream(
  messages: (AgentMessage | AGUIMessage)[],
  isRunning = false,
): {
  entries: TraceEntry[];
  summary: TraceSummary;
} {
  // Tick counter ensures running durations update even when messages aren't changing
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [isRunning]);

  return useMemo(() => {
    const now = Date.now();
    const entries: TraceEntry[] = [];
    const openSpans = new Map<string, number>();
    const entryMap = new Map<string, TraceEntry>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      let entry: TraceEntry | null = null;

      if (isAgentMessage(msg)) {
        entry = buildFromAgentMessage(msg, i, now, openSpans, entryMap);
      } else if (isAGUIMessage(msg)) {
        entry = buildFromAGUIMessage(msg, i, now);
      }

      if (entry) {
        entries.push(entry);
      }
    }

    // Build summary
    const summary: TraceSummary = {
      totalDuration: 0,
      totalTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      totalCost: 0,
      operationCount: entries.length,
      byType: {},
    };

    for (const entry of entries) {
      if (entry.duration) summary.totalDuration += entry.duration;
      if (entry.tokens) {
        summary.totalTokens.input += entry.tokens.input;
        summary.totalTokens.output += entry.tokens.output;
        summary.totalTokens.cacheRead += entry.tokens.cacheRead ?? 0;
        summary.totalTokens.cacheCreation += entry.tokens.cacheCreation ?? 0;
      }
      if (entry.cost) summary.totalCost += entry.cost;
      summary.byType[entry.type] = (summary.byType[entry.type] ?? 0) + 1;
    }

    return { entries, summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, tick]);
}
