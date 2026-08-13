/**
 * Fake-binary integration tests for the shared CLI agent turn driver.
 * Spawns `node -e` scripts standing in for cursor-agent/qwen/copilot to
 * prove the spawn → parse → error-mapping loop without real CLIs.
 */

import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { CopilotStreamParser } from '@/extensions/agent/copilot/stream';
import { CursorAgentStreamParser } from '@/extensions/agent/cursor-agent/stream';
import {
  PlainTextStreamParser,
  streamCliAgentTurn,
  type CliStreamParser,
} from '@/extensions/agent/shared/cli';

async function runFake(
  script: string,
  parser: CliStreamParser,
  runtimeName = 'Fake Runtime',
): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  for await (const message of streamCliAgentTurn({
    runtimeName,
    parser,
    spec: {
      binaryPath: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '' },
      stdinText: 'hello',
      timeoutMs: 15_000,
    },
  })) {
    messages.push(message);
  }
  return messages;
}

describe('streamCliAgentTurn', () => {
  it('streams cursor-style JSONL from a fake binary into agent messages', async () => {
    const script = `
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'sonnet-4' }),
        JSON.stringify({ type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'Hi ' }] } }),
        JSON.stringify({ type: 'assistant', timestamp_ms: 2, message: { content: [{ type: 'text', text: 'there' }] } }),
        JSON.stringify({ type: 'assistant', model_call_id: 'c1', message: { content: [{ type: 'text', text: 'Hi there!' }] } }),
        JSON.stringify({ type: 'result', duration_ms: 5, usage: { inputTokens: 1, outputTokens: 2 } }),
      ];
      process.stdin.resume();
      process.stdin.on('end', () => { for (const l of lines) console.log(l); });
    `;
    const messages = await runFake(script, new CursorAgentStreamParser());

    const text = messages
      .filter((m) => m.type === 'text')
      .map((m) => m.content)
      .join('');
    expect(text).toBe('Hi there!');
    expect(messages.some((m) => m.type === 'result')).toBe(true);
    expect(messages.some((m) => m.type === 'error')).toBe(false);
    expect(messages.at(-1)).toEqual({ type: 'done' });
  });

  it('streams copilot-style JSONL including tool events', async () => {
    const script = `
      const lines = [
        JSON.stringify({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'bash', arguments: {} } }),
        JSON.stringify({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: true, result: 'ok' } }),
        JSON.stringify({ type: 'assistant.message_delta', data: { deltaContent: 'done' } }),
        JSON.stringify({ type: 'result', success: true }),
      ];
      for (const l of lines) console.log(l);
    `;
    const messages = await runFake(script, new CopilotStreamParser());

    expect(messages.some((m) => m.type === 'tool_use' && m.id === 't1')).toBe(
      true,
    );
    expect(
      messages.some((m) => m.type === 'tool_result' && m.toolUseId === 't1'),
    ).toBe(true);
    expect(messages.some((m) => m.type === 'error')).toBe(false);
    expect(messages.at(-1)).toEqual({ type: 'done' });
  });

  it('streams plain text output for qwen-style runtimes', async () => {
    const messages = await runFake(
      `process.stdout.write('line one\\n'); process.stdout.write('line two\\n');`,
      new PlainTextStreamParser(),
    );
    const text = messages
      .filter((m) => m.type === 'text')
      .map((m) => m.content)
      .join('');
    expect(text).toContain('line one');
    expect(text).toContain('line two');
    expect(messages.some((m) => m.type === 'error')).toBe(false);
  });

  it('maps a non-zero exit with stderr to a visible run error', async () => {
    const messages = await runFake(
      `process.stderr.write('auth required: run login'); process.exit(2);`,
      new PlainTextStreamParser(),
      'Qwen Code',
    );
    const error = messages.find((m) => m.type === 'error');
    expect(error?.message).toContain('auth required');
    expect(messages.at(-1)).toEqual({ type: 'done' });
  });

  it('flags an empty successful run instead of ending silently', async () => {
    const messages = await runFake(
      `/* exits 0 with no output */`,
      new PlainTextStreamParser(),
    );
    const error = messages.find((m) => m.type === 'error');
    expect(error?.message).toContain('without producing output');
  });

  it('rewrites a fenced ask_user_question block into a tool_use event', async () => {
    const payload = JSON.stringify({
      questions: [
        {
          question: 'Which env?',
          header: 'Env',
          options: [
            { label: 'dev', description: 'development' },
            { label: 'prod', description: 'production' },
          ],
          multiSelect: false,
        },
      ],
    });
    const script = `
      console.log('\\u0060\\u0060\\u0060neuma:ask_user_question');
      console.log(${JSON.stringify(payload)});
      console.log('\\u0060\\u0060\\u0060');
    `;
    const messages = await runFake(script, new PlainTextStreamParser());
    const toolUse = messages.find((m) => m.type === 'tool_use');
    expect(toolUse?.name).toBe('AskUserQuestion');
  });
});
