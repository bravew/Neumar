import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { CopilotStreamParser } from '@/extensions/agent/copilot/stream';

function collect(
  parser: CopilotStreamParser,
  events: unknown[],
): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const event of events) {
    out.push(...parser.feed(`${JSON.stringify(event)}\n`));
  }
  out.push(...parser.flush());
  return out;
}

describe('CopilotStreamParser', () => {
  it('maps session.tools_updated to system init with the model', () => {
    const messages = collect(new CopilotStreamParser(), [
      { type: 'session.tools_updated', data: { model: 'claude-sonnet-5' } },
    ]);
    expect(messages).toEqual([
      { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
    ]);
  });

  it('maps reasoning and message deltas to thinking and text', () => {
    const parser = new CopilotStreamParser();
    const messages = collect(parser, [
      { type: 'assistant.reasoning_delta', data: { deltaContent: 'hmm' } },
      { type: 'assistant.message_delta', data: { deltaContent: 'Hello' } },
    ]);
    expect(messages).toEqual([
      { type: 'thinking', content: 'hmm' },
      { type: 'text', content: 'Hello' },
    ]);
    expect(parser.sawText).toBe(true);
  });

  it('maps tool execution start/complete to tool_use/tool_result', () => {
    const messages = collect(new CopilotStreamParser(), [
      {
        type: 'tool.execution_start',
        data: { toolCallId: 't1', toolName: 'bash', arguments: { cmd: 'ls' } },
      },
      {
        type: 'tool.execution_complete',
        data: {
          toolCallId: 't1',
          success: true,
          result: { content: 'file.txt' },
        },
      },
    ]);
    expect(messages[0]).toMatchObject({
      type: 'tool_use',
      id: 't1',
      name: 'bash',
      input: { cmd: 'ls' },
    });
    expect(messages[1]).toMatchObject({
      type: 'tool_result',
      toolUseId: 't1',
      content: 'file.txt',
      isError: false,
    });
  });

  it('flags failed tool executions as error results', () => {
    const messages = collect(new CopilotStreamParser(), [
      {
        type: 'tool.execution_complete',
        data: { toolCallId: 't2', success: false, result: 'denied' },
      },
    ]);
    expect(messages[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 't2',
      isError: true,
    });
  });

  it('maps a successful result to usage even without exitCode', () => {
    const messages = collect(new CopilotStreamParser(), [
      {
        type: 'result',
        success: true,
        usage: { inputTokens: 7, outputTokens: 3, sessionDurationMs: 900 },
      },
    ]);
    expect(messages).toEqual([
      {
        type: 'result',
        usage: { input_tokens: 7, output_tokens: 3 },
        duration: 900,
      },
    ]);
  });

  it('maps a failed result to a visible error', () => {
    const parser = new CopilotStreamParser();
    const messages = collect(parser, [
      { type: 'result', success: false, error: 'subscription required' },
    ]);
    expect(messages[0]).toMatchObject({
      type: 'error',
      message: 'subscription required',
    });
    expect(parser.sawError).toBe(true);
  });

  it('passes non-JSON stdout through as text', () => {
    const parser = new CopilotStreamParser();
    const out = [...parser.feed('please run copilot auth login\n')];
    expect(out).toEqual([
      { type: 'text', content: 'please run copilot auth login\n' },
    ]);
  });

  it('buffers partial JSONL lines across chunks', () => {
    const parser = new CopilotStreamParser();
    const line = JSON.stringify({
      type: 'assistant.message_delta',
      data: { deltaContent: 'chunked' },
    });
    const out: AgentMessage[] = [
      ...parser.feed(line.slice(0, 10)),
      ...parser.feed(`${line.slice(10)}\n`),
      ...parser.flush(),
    ];
    expect(out).toEqual([{ type: 'text', content: 'chunked' }]);
  });
});
