/**
 * Typed turn budget (P2-5).
 *
 * Claude, Codex, and Cursor do not share a stop protocol: one reports
 * `terminal_reason`, another a `subtype`, a third only a message. The Video
 * Agent passes `maxTurns: 60` and the UI had no way to tell "the model
 * finished" from "we hit the ceiling mid-assembly". This module owns the one
 * normalization every adapter's result flows through, so `AgentDock` can say
 * which happened — and whether continuing would help.
 *
 * It lives at the shared agent-runtime boundary, not in Video Mode, because
 * every mode has the same question.
 */

export const TURN_STOP_REASONS = [
  'end_turn',
  'max_steps',
  'max_tool_calls',
  'max_tokens',
  'budget',
  'cancelled',
  'refusal',
  'error',
  'unknown',
] as const;

export type TurnStopReason = (typeof TURN_STOP_REASONS)[number];

export interface TurnBudgetOutcome {
  reason: TurnStopReason;
  /** The provider-specific string this was normalized from, for debugging. */
  raw?: string;
  /**
   * True when the run stopped against a ceiling rather than finishing, so
   * "continue" is a meaningful offer instead of a retry of a failure.
   */
  exhausted: boolean;
  /** The configured ceiling, when the caller knows it. */
  limit?: number;
}

export interface NormalizeStopReasonInput {
  /** Adapter `result` subtype (`success`, `error_max_turns`, …). */
  subtype?: string | undefined;
  /** Agent SDK ≥0.2.91 `terminal_reason`. */
  terminalReason?: string | undefined;
  /** Error code, when the run ended on an error message. */
  code?: string | undefined;
  message?: string | undefined;
  /** Configured turn ceiling for this run, echoed into the outcome. */
  limit?: number | undefined;
}

const EXHAUSTED: ReadonlySet<TurnStopReason> = new Set([
  'max_steps',
  'max_tool_calls',
  'max_tokens',
  'budget',
]);

/**
 * Ordered most-specific-first. Every entry matches against the lowercased
 * concatenation of subtype, terminal reason, code, and message.
 */
const PATTERNS: Array<[RegExp, TurnStopReason]> = [
  [
    /max_tool_calls|tool[_ ]call[_ ]limit|too many tool calls/,
    'max_tool_calls',
  ],
  [
    /max_turns|max_steps|maximum number of turns|step[_ ]limit|turn[_ ]limit/,
    'max_steps',
  ],
  [/max_tokens|token[_ ]limit|context[_ ]length|output[_ ]limit/, 'max_tokens'],
  [/max_budget|budget[_ ]exceeded|budget_exceeded|cost[_ ]limit/, 'budget'],
  [
    /abort|cancel|interrupt|user[_ ]stopped|stopped by (?:the )?user/,
    'cancelled',
  ],
  [/refusal|refused|stop[_ ]sequence[_ ]refusal/, 'refusal'],
  [/end_turn|^success$|completed|finished/, 'end_turn'],
  [/error|failed|failure/, 'error'],
];

export function normalizeStopReason(
  input: NormalizeStopReasonInput,
): TurnBudgetOutcome {
  const parts = [
    input.terminalReason,
    input.subtype,
    input.code,
    input.message,
  ].filter((part): part is string => Boolean(part));
  const haystack = parts.join(' ').toLowerCase();
  const raw = input.terminalReason ?? input.subtype ?? input.code;

  const reason =
    PATTERNS.find(([pattern]) => pattern.test(haystack))?.[1] ??
    (parts.length === 0 ? 'unknown' : 'end_turn');

  return {
    reason,
    ...(raw ? { raw } : {}),
    exhausted: EXHAUSTED.has(reason),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };
}

/** Stable event name for the normalized outcome on the AG-UI stream. */
export const TURN_BUDGET_EVENT_NAME = 'neuma.turn_budget';
