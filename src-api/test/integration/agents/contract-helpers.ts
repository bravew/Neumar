/**
 * Adapter event-vocabulary contract.
 *
 * Phase 2 Step 6 of the agent-loop modernization plan calls for every
 * adapter (claude, codex, http-agent, openai-compat, …) to emit the same
 * AG-UI event vocabulary so the React thread store has a single set of
 * cases to handle. This module is the runnable form of that contract:
 * an adapter test feeds the emitter with the adapter's normalized
 * AgentMessage stream, then calls `assertEventVocabulary(events)` to
 * verify the structural invariants every consumer relies on.
 *
 * Invariants enforced:
 *   1. Stream is bracketed by RUN_STARTED → RUN_FINISHED or RUN_ERROR.
 *   2. Every event carries a monotonic `seq` and numeric `timestamp`.
 *   3. Lifecycle pairs balance:
 *        TEXT_MESSAGE_START   ↔ TEXT_MESSAGE_END
 *        REASONING_MESSAGE_*  ↔ REASONING_MESSAGE_END
 *        TOOL_CALL_START      ↔ TOOL_CALL_END
 *        STEP_STARTED         ↔ STEP_FINISHED
 *      No ARGS/CONTENT events without a matching START.
 *   4. TOOL_CALL_RESULT references a known toolCallId.
 *
 * Snapshot tests can be layered on top (e.g. `expect(eventTypes).toEqual([...])`)
 * but invariant checks are the bedrock — snapshots break for cosmetic
 * reasons that don't represent real contract violations.
 */

import { EventType, type BaseEvent } from '@ag-ui/core';
import { expect } from 'vitest';

export interface VocabularyAssertionOptions {
  /** Permit RUN_ERROR as the terminal event in addition to RUN_FINISHED. */
  allowRunError?: boolean;
  /**
   * Permit lifecycle violations of these specific kinds. Use sparingly —
   * the point of the contract is to prevent silent drift. Documenting
   * known-broken adapters here makes the gap explicit.
   */
  knownGaps?: Array<'unbalanced_text' | 'unbalanced_tool' | 'no_run_started'>;
}

export function assertEventVocabulary(
  events: BaseEvent[],
  options: VocabularyAssertionOptions = {},
): void {
  const knownGaps = new Set(options.knownGaps ?? []);

  // ── 1. Bracketing ─────────────────────────────────────────────────
  if (!knownGaps.has('no_run_started')) {
    expect(events.length, 'expected at least one event').toBeGreaterThan(0);
    expect(events[0]!.type, 'first event should be RUN_STARTED').toBe(
      EventType.RUN_STARTED,
    );
  }
  const last = events[events.length - 1];
  const terminalIsFinished = last?.type === EventType.RUN_FINISHED;
  const terminalIsError = last?.type === EventType.RUN_ERROR;
  expect(
    terminalIsFinished || (options.allowRunError && terminalIsError),
    `last event should be RUN_FINISHED${
      options.allowRunError ? ' or RUN_ERROR' : ''
    }, got ${last?.type ?? '<empty>'}`,
  ).toBe(true);

  // ── 2. Monotonic seq + timestamp ──────────────────────────────────
  let prevSeq = -1;
  for (const event of events) {
    const e = event as BaseEvent & { seq?: number; timestamp?: number };
    expect(typeof e.seq, `event ${e.type} missing numeric seq`).toBe('number');
    expect(
      typeof e.timestamp,
      `event ${e.type} missing numeric timestamp`,
    ).toBe('number');
    expect(e.seq, 'seq must be strictly increasing').toBeGreaterThan(prevSeq);
    prevSeq = e.seq!;
  }

  // ── 3. Lifecycle pairing ──────────────────────────────────────────
  const openTextMessages = new Set<string>();
  const openReasoningMessages = new Set<string>();
  const openToolCalls = new Map<string, string>(); // id → name
  const knownToolCallIds = new Set<string>();
  const openSteps = new Set<string>();

  for (const event of events) {
    const e = event as BaseEvent & Record<string, string | number | undefined>;
    switch (e.type) {
      case EventType.TEXT_MESSAGE_START:
        if (typeof e.messageId === 'string') openTextMessages.add(e.messageId);
        break;
      case EventType.TEXT_MESSAGE_CONTENT:
        if (
          typeof e.messageId === 'string' &&
          !openTextMessages.has(e.messageId) &&
          !knownGaps.has('unbalanced_text')
        ) {
          throw new Error(
            `TEXT_MESSAGE_CONTENT for unopened messageId ${e.messageId}`,
          );
        }
        break;
      case EventType.TEXT_MESSAGE_END:
        if (typeof e.messageId === 'string')
          openTextMessages.delete(e.messageId);
        break;

      case EventType.REASONING_MESSAGE_START:
        if (typeof e.messageId === 'string')
          openReasoningMessages.add(e.messageId);
        break;
      case EventType.REASONING_MESSAGE_END:
        if (typeof e.messageId === 'string')
          openReasoningMessages.delete(e.messageId);
        break;

      case EventType.TOOL_CALL_START:
        if (typeof e.toolCallId === 'string') {
          openToolCalls.set(e.toolCallId, String(e.toolCallName ?? ''));
          knownToolCallIds.add(e.toolCallId);
        }
        break;
      case EventType.TOOL_CALL_ARGS:
        if (
          typeof e.toolCallId === 'string' &&
          !openToolCalls.has(e.toolCallId) &&
          !knownGaps.has('unbalanced_tool')
        ) {
          throw new Error(
            `TOOL_CALL_ARGS for unopened toolCallId ${e.toolCallId}`,
          );
        }
        break;
      case EventType.TOOL_CALL_END:
        if (typeof e.toolCallId === 'string')
          openToolCalls.delete(e.toolCallId);
        break;
      case EventType.TOOL_CALL_RESULT:
        if (
          typeof e.toolCallId === 'string' &&
          !knownToolCallIds.has(e.toolCallId) &&
          !knownGaps.has('unbalanced_tool')
        ) {
          throw new Error(
            `TOOL_CALL_RESULT for unknown toolCallId ${e.toolCallId}`,
          );
        }
        break;

      case EventType.STEP_STARTED:
        if (typeof e.stepName === 'string') openSteps.add(e.stepName);
        break;
      case EventType.STEP_FINISHED:
        if (typeof e.stepName === 'string') openSteps.delete(e.stepName);
        break;
    }
  }

  if (!knownGaps.has('unbalanced_text')) {
    expect(
      Array.from(openTextMessages),
      'unclosed TEXT_MESSAGE_* lifecycles',
    ).toEqual([]);
    expect(
      Array.from(openReasoningMessages),
      'unclosed REASONING_MESSAGE_* lifecycles',
    ).toEqual([]);
  }
  if (!knownGaps.has('unbalanced_tool')) {
    expect(
      Array.from(openToolCalls.keys()),
      'unclosed TOOL_CALL_* lifecycles',
    ).toEqual([]);
  }
  expect(Array.from(openSteps), 'unclosed STEP_* lifecycles').toEqual([]);
}

/** Convenience: extract just the event types in order for snapshot-style assertions. */
export function eventTypes(events: BaseEvent[]): string[] {
  return events.map((e) => e.type);
}
