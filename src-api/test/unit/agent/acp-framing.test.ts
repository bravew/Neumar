import { ndJsonStream } from '@zed-industries/agent-client-protocol';
import { describe, expect, it, vi } from 'vitest';

function inputStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function outputStream(): WritableStream<Uint8Array> {
  return new WritableStream({ write() {} });
}

describe('ACP NDJSON framing', () => {
  it('preserves partial and concatenated complete frames', async () => {
    const stream = ndJsonStream(
      outputStream(),
      inputStream([
        '{"jsonrpc":"2.0","id":1,',
        '"result":{}}\n{"jsonrpc":"2.0","id":2,"result":{}}\n',
      ]),
    );
    const reader = stream.readable.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      value: { jsonrpc: '2.0', id: 1, result: {} },
      done: false,
    });
    await expect(reader.read()).resolves.toMatchObject({
      value: { jsonrpc: '2.0', id: 2, result: {} },
      done: false,
    });
    await expect(reader.read()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it('reports malformed complete frames without hanging the stream', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const stream = ndJsonStream(outputStream(), inputStream(['not-json\n']));
    await expect(stream.readable.getReader().read()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to parse JSON message:',
      'not-json',
      expect.any(SyntaxError),
    );
    consoleError.mockRestore();
  });
});
