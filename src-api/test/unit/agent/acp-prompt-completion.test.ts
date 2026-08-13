import { describe, expect, it, vi } from 'vitest';

import {
  AcpRuntimeClient,
  AcpTurnActivity,
  runAcpPromptSequence,
} from '@/extensions/agent/shared/acp';

function sequence<T>(options: {
  activity?: AcpTurnActivity;
  send: (prompt: string, continuation: boolean) => Promise<T>;
  onContinuation?: () => void | Promise<void>;
}) {
  return runAcpPromptSequence({
    activity: options.activity ?? new AcpTurnActivity(),
    initialPrompt: 'initial prompt',
    send: options.send,
    onContinuation: options.onContinuation ?? (() => undefined),
  });
}

describe('ACP prompt completion', () => {
  it('surfaces process spawn errors through the protocol promise', async () => {
    await expect(
      AcpRuntimeClient.connect({
        binaryPath: `${process.cwd()}/missing-acp-binary`,
        args: [],
        cwd: process.cwd(),
        env: process.env,
        stageTimeoutMs: 1_000,
        onMessage: () => undefined,
      }),
    ).rejects.toThrow(/missing-acp-binary|ENOENT/);
  });

  it('completes from the explicit prompt response', async () => {
    const send = vi.fn(async () => ({ stopReason: 'end_turn' }));
    await expect(sequence({ send })).resolves.toEqual({
      stopReason: 'end_turn',
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not wait for the child process to exit after prompt completion', async () => {
    let childAlive = true;
    const result = await sequence({
      send: async () => ({ stopReason: 'end_turn' }),
    });
    expect(result.stopReason).toBe('end_turn');
    expect(childAlive).toBe(true);
    childAlive = false;
  });

  it('ignores a late process error after the resolved prompt response', async () => {
    let lateError: Error | undefined;
    const result = await sequence({
      send: async () => {
        queueMicrotask(() => {
          lateError = new Error('late stderr/exit');
        });
        return { stopReason: 'end_turn' };
      },
    });
    await Promise.resolve();
    expect(result.stopReason).toBe('end_turn');
    expect(lateError?.message).toBe('late stderr/exit');
  });

  it('settles once when a protocol peer attempts duplicate completion', async () => {
    const send = vi.fn(
      () =>
        new Promise<{ stopReason: string }>((resolve) => {
          resolve({ stopReason: 'first' });
          resolve({ stopReason: 'duplicate' });
        }),
    );
    await expect(sequence({ send })).resolves.toEqual({ stopReason: 'first' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('propagates cancellation without starting a continuation', async () => {
    const onContinuation = vi.fn();
    const cancellation = new Error('cancelled');
    cancellation.name = 'AbortError';
    await expect(
      sequence({
        send: async () => {
          throw cancellation;
        },
        onContinuation,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(onContinuation).not.toHaveBeenCalled();
  });

  it('uses one same-session continuation after a terminal tool result stalls', async () => {
    const activity = new AcpTurnActivity();
    const onContinuation = vi.fn();
    const sessionIds: string[] = [];
    const send = vi.fn(async (_prompt: string, continuation: boolean) => {
      sessionIds.push('same-session');
      if (!continuation) {
        activity.observe({
          type: 'tool_result',
          toolUseId: 'tool-1',
          output: 'ok',
        });
        return { stopReason: 'tool_end' };
      }
      // A second stall cannot trigger a third prompt.
      activity.observe({
        type: 'tool_result',
        toolUseId: 'tool-2',
        output: 'ok',
      });
      return { stopReason: 'end_turn' };
    });

    await expect(sequence({ activity, send, onContinuation })).resolves.toEqual(
      { stopReason: 'end_turn' },
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toContain('Continue the same turn');
    expect(sessionIds).toEqual(['same-session', 'same-session']);
    expect(onContinuation).toHaveBeenCalledOnce();
  });

  it('does not continue when assistant text follows the tool result', async () => {
    const activity = new AcpTurnActivity();
    const send = vi.fn(async () => {
      activity.observe({ type: 'tool_result', toolUseId: 'tool-1' });
      activity.observe({ type: 'text', content: 'Finished.' });
      return { stopReason: 'end_turn' };
    });
    await sequence({ activity, send });
    expect(send).toHaveBeenCalledOnce();
  });
});
