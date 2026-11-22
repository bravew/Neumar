import type {
  DownloadActivity,
  DownloadMediaOperation,
} from '@neumar/video-ir';
import { describe, expect, it } from 'vitest';

import { withDownloadBatch } from '@/shared/services/media-download/run-batch';

const operation: DownloadMediaOperation = {
  version: 1,
  taskId: 'task',
  runId: 'run',
  toolCallId: 'call',
  batchId: 'b7e6f9d2-3c1a-4e5f-9a8b-0c1d2e3f4a5b',
  destinationGrantId: 'a7a51dbe-bdf2-427d-b320-691d6872ef52',
  input: { urls: ['https://example.org/a', 'https://example.org/b'] },
};

const activity = (items: DownloadActivity['items']): DownloadActivity => ({
  version: 1,
  taskId: 'task',
  runId: 'run',
  toolCallId: 'call',
  batchId: operation.batchId,
  items,
});

async function* done() {
  yield { type: 'done' as const };
}

describe('withDownloadBatch', () => {
  it('keeps a saved item when the batch then rejects', async () => {
    const saved = {
      itemId: '1',
      sequence: 2,
      phase: 'saved' as const,
      asset: { assetId: 'asset-1', name: 'a.mp4', mime: 'video/mp4', size: 1 },
    };
    const seen: DownloadActivity[] = [];
    for await (const message of withDownloadBatch(
      done(),
      operation,
      async (_op, { emit }) => {
        emit(
          activity([
            saved,
            {
              itemId: '2',
              sequence: 1,
              phase: 'transferring',
              streams: [{ streamId: '137', bytes: 5 }],
            },
          ]),
        );
        throw new Error('runner crashed');
      },
      new AbortController().signal,
    )) {
      if (
        message.type === 'media_download_activity' &&
        message.downloadActivity
      ) {
        seen.push(message.downloadActivity);
      }
    }

    const last = seen.at(-1)!;
    expect(last.items[0]).toEqual(saved);
    // The settled row sorts after the last state the card was told.
    expect(last.items[1]).toMatchObject({
      itemId: '2',
      sequence: 2,
      phase: 'failed',
      reason: 'download',
    });
  });

  it('delivers progress while the agent stream is still waiting', async () => {
    let releaseAgent!: () => void;
    const agentGate = new Promise<void>((resolve) => {
      releaseAgent = resolve;
    });
    async function* agent() {
      await agentGate;
      yield { type: 'done' as const };
    }
    const order: string[] = [];
    for await (const message of withDownloadBatch(
      agent(),
      operation,
      async (_op, { emit }) => {
        const progress = activity([
          { itemId: '1', sequence: 1, phase: 'queued' },
          { itemId: '2', sequence: 1, phase: 'queued' },
        ]);
        emit(progress);
        // Hold the batch open until the client has seen the progress.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return progress;
      },
      new AbortController().signal,
    )) {
      order.push(message.type);
      if (message.type === 'media_download_activity') releaseAgent();
    }

    // The agent never produced anything before it was released, so the
    // activity arriving first proves it was not queued behind the agent.
    expect(order[0]).toBe('media_download_activity');
    expect(order.at(-1)).toBe('done');
  });
});
