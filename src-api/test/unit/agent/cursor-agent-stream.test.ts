import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { CursorAgentStreamParser } from '@/extensions/agent/cursor-agent/stream';

function collect(
  parser: CursorAgentStreamParser,
  lines: string[],
): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const line of lines) {
    out.push(...parser.feed(`${line}\n`));
  }
  out.push(...parser.flush());
  return out;
}

function assistantDelta(text: string, timestamp = 1000): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp_ms: timestamp,
    message: { content: [{ type: 'text', text }] },
  });
}

function assistantReplay(text: string, modelCallId?: string): string {
  return JSON.stringify({
    type: 'assistant',
    ...(modelCallId ? { model_call_id: modelCallId } : {}),
    message: { content: [{ type: 'text', text }] },
  });
}

describe('CursorAgentStreamParser', () => {
  it('maps system init to a system message with the model', () => {
    const messages = collect(new CursorAgentStreamParser(), [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'sonnet-4' }),
    ]);
    expect(messages).toEqual([
      { type: 'system', subtype: 'init', model: 'sonnet-4' },
    ]);
  });

  it('streams timestamped deltas verbatim, including repeated content', () => {
    const messages = collect(new CursorAgentStreamParser(), [
      assistantDelta('ha'),
      assistantDelta('ha'),
    ]);
    expect(messages.map((m) => m.content)).toEqual(['ha', 'ha']);
  });

  it('emits only the missing suffix from a model_call_id terminal replay', () => {
    const parser = new CursorAgentStreamParser();
    const messages = collect(parser, [
      assistantDelta('Hello'),
      assistantReplay('Hello world', 'call-1'),
    ]);
    expect(messages.map((m) => m.content)).toEqual(['Hello', ' world']);
  });

  it('does not duplicate output on a divergent replay', () => {
    const parser = new CursorAgentStreamParser();
    const messages = collect(parser, [
      assistantDelta('Hello there'),
      assistantReplay('Hello world', 'call-1'),
    ]);
    expect(messages.map((m) => m.content)).toEqual(['Hello there']);
  });

  it('reconciles replays per turn, not against the cross-turn buffer', () => {
    const parser = new CursorAgentStreamParser();
    const first = collect(parser, [
      assistantDelta('first'),
      assistantReplay('first'),
    ]);
    expect(first.map((m) => m.content)).toEqual(['first']);

    // Second turn: a fallback-terminated replay of "second" must not
    // re-append the whole replay ("secondsecond").
    const second = [
      ...parser.feed(`${assistantDelta('second')}\n`),
      ...parser.feed(`${assistantReplay('second')}\n`),
      ...parser.flush(),
    ];
    expect(second.map((m) => m.content)).toEqual(['second']);
  });

  it('recovers the full text when no streaming chunk arrived before the replay', () => {
    const parser = new CursorAgentStreamParser();
    const messages = collect(parser, [assistantReplay('entire answer', 'c1')]);
    expect(messages.map((m) => m.content)).toEqual(['entire answer']);
  });

  it('maps result usage into the agent usage shape', () => {
    const messages = collect(new CursorAgentStreamParser(), [
      JSON.stringify({
        type: 'result',
        duration_ms: 1234,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 5,
          cacheWriteTokens: 2,
        },
      }),
    ]);
    expect(messages).toEqual([
      {
        type: 'result',
        duration: 1234,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 2,
        },
      },
    ]);
  });

  it('surfaces structured errors and records sawError', () => {
    const parser = new CursorAgentStreamParser();
    const messages = collect(parser, [
      JSON.stringify({ type: 'error', message: 'not authenticated' }),
    ]);
    expect(messages[0]).toMatchObject({
      type: 'error',
      message: 'not authenticated',
    });
    expect(parser.sawError).toBe(true);
  });

  it('passes non-JSON stdout through as text instead of dropping it', () => {
    const parser = new CursorAgentStreamParser();
    const messages = collect(parser, ['plain banner line']);
    expect(messages).toEqual([
      { type: 'text', content: 'plain banner line\n' },
    ]);
    expect(parser.sawText).toBe(true);
  });

  it('handles JSON events split across chunk boundaries', () => {
    const parser = new CursorAgentStreamParser();
    const line = assistantDelta('split');
    const out: AgentMessage[] = [
      ...parser.feed(line.slice(0, 12)),
      ...parser.feed(`${line.slice(12)}\n`),
      ...parser.flush(),
    ];
    expect(out.map((m) => m.content)).toEqual(['split']);
  });
});
