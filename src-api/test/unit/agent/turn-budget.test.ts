import { describe, expect, it } from 'vitest';

import { normalizeStopReason } from '@/core/agent/turn-budget';

describe('normalizeStopReason', () => {
  it('normalizes the Claude SDK turn-limit stop', () => {
    expect(
      normalizeStopReason({ subtype: 'error_max_turns', limit: 60 }),
    ).toEqual({
      reason: 'max_steps',
      raw: 'error_max_turns',
      exhausted: true,
      limit: 60,
    });
  });

  it('normalizes a Codex-style prose stop', () => {
    expect(
      normalizeStopReason({ message: 'Reached maximum number of turns' }),
    ).toMatchObject({ reason: 'max_steps', exhausted: true });
  });

  it('normalizes a tool-call ceiling ahead of the turn ceiling', () => {
    expect(
      normalizeStopReason({ terminalReason: 'max_tool_calls' }),
    ).toMatchObject({ reason: 'max_tool_calls', exhausted: true });
  });

  it('normalizes budget and token ceilings', () => {
    expect(
      normalizeStopReason({ subtype: 'error_max_budget_usd' }),
    ).toMatchObject({ reason: 'budget', exhausted: true });
    expect(normalizeStopReason({ terminalReason: 'max_tokens' })).toMatchObject(
      { reason: 'max_tokens', exhausted: true },
    );
  });

  it('treats a clean finish as end_turn and not exhausted', () => {
    expect(normalizeStopReason({ subtype: 'success' })).toMatchObject({
      reason: 'end_turn',
      exhausted: false,
    });
    expect(normalizeStopReason({ terminalReason: 'end_turn' })).toMatchObject({
      reason: 'end_turn',
      exhausted: false,
    });
  });

  it('distinguishes cancellation and refusal from failure', () => {
    expect(
      normalizeStopReason({ message: 'Run stopped by user' }),
    ).toMatchObject({ reason: 'cancelled', exhausted: false });
    expect(normalizeStopReason({ terminalReason: 'refusal' })).toMatchObject({
      reason: 'refusal',
      exhausted: false,
    });
  });

  it('falls back to error for unmatched failures and unknown for no signal', () => {
    expect(
      normalizeStopReason({ subtype: 'error_during_execution' }),
    ).toMatchObject({ reason: 'error', exhausted: false });
    expect(normalizeStopReason({})).toMatchObject({
      reason: 'unknown',
      exhausted: false,
    });
  });

  it('prefers the terminal reason over a noisy message', () => {
    expect(
      normalizeStopReason({
        terminalReason: 'end_turn',
        message: 'the tool reported an error earlier in the run',
      }),
    ).toMatchObject({ reason: 'end_turn' });
  });
});
