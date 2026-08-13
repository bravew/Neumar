/**
 * Event-vocabulary contract — applied to AGUIEmitter as the canonical
 * worked example. Every adapter that flows through AGUIEmitter inherits
 * these checks; adapters that build their own AG-UI streams (e.g. http-agent
 * relaying upstream events directly) should reuse `assertEventVocabulary`
 * directly against their output.
 */

import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../../src/core/agent/types';
import { AGUIEmitter } from '../../../src/shared/services/ag-ui/emitter';
import { assertEventVocabulary, eventTypes } from './contract-helpers';

async function collectEvents(messages: AgentMessage[]) {
  const emitter = new AGUIEmitter('thread-c', 'run-c');
  async function* source() {
    yield* messages;
  }
  const events = [];
  for await (const event of emitter.transform(source())) {
    events.push(event);
  }
  return events;
}

describe('contract: event vocabulary', () => {
  it('empty stream still satisfies bracketing + monotonic invariants', async () => {
    const events = await collectEvents([]);
    assertEventVocabulary(events);
  });

  it('tool_use → tool_result satisfies pairing + ordering', async () => {
    const events = await collectEvents([
      { type: 'text', content: 'hello' },
      {
        type: 'tool_use',
        id: 'call-1',
        name: 'fs.read',
        input: { path: 'a.txt' },
      },
      {
        type: 'tool_result',
        toolUseId: 'call-1',
        output: 'file contents',
      },
    ]);
    assertEventVocabulary(events);
    // Sanity: contract-helpers exposes type extraction for snapshot-lite asserts.
    const types = eventTypes(events);
    expect(types[0]).toBe('RUN_STARTED');
    expect(types).toContain('TOOL_CALL_START');
    expect(types).toContain('TOOL_CALL_END');
    expect(types).toContain('TOOL_CALL_RESULT');
  });

  it('reasoning lifecycle is balanced', async () => {
    const events = await collectEvents([
      { type: 'thinking', content: 'reasoning…' },
      { type: 'text', content: 'final' },
    ]);
    assertEventVocabulary(events);
  });

  it('flags unclosed tool calls when invariants violated (negative test)', () => {
    // Hand-craft a malformed stream — the helper must throw to prove the
    // contract isn't a no-op. A real adapter test would never construct
    // this; we're proving the assertion fires.
    const malformed = [
      { type: 'RUN_STARTED', seq: 0, timestamp: 1, threadId: 't', runId: 'r' },
      {
        type: 'TOOL_CALL_START',
        seq: 1,
        timestamp: 2,
        toolCallId: 'x',
        toolCallName: 'noop',
      },
      // missing TOOL_CALL_END
      { type: 'RUN_FINISHED', seq: 2, timestamp: 3, threadId: 't', runId: 'r' },
    ];
    expect(() => assertEventVocabulary(malformed as never)).toThrow();
  });

  it('allowRunError opt-in lets streams terminate on RUN_ERROR', async () => {
    const events = await collectEvents([
      {
        type: 'error',
        subtype: 'tool_error',
        content: 'boom',
      },
    ]);
    // Emitter terminates the stream with RUN_ERROR for this fixture.
    const last = events[events.length - 1];
    expect(last?.type).toBe('RUN_ERROR');
    assertEventVocabulary(events, { allowRunError: true });
  });
});
