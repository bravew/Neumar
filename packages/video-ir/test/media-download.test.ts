import { describe, expect, it } from 'vitest';

import {
  applyDownloadUpdate,
  downloadActivitySchema,
  downloadMediaInputSchema,
  downloadMediaOperationSchema,
  downloadUpdateSchema,
  type DownloadItem,
} from '../src/media-download.js';

const scope = {
  version: 1,
  taskId: 'task',
  runId: 'run',
  toolCallId: 'call',
  batchId: 'batch',
};
const initial = downloadActivitySchema.parse({
  ...scope,
  items: ['a', 'b'].map((itemId) => ({
    itemId,
    sequence: 0,
    phase: 'waiting',
  })),
});
const events: DownloadItem[] = [
  {
    itemId: 'a',
    sequence: 1,
    phase: 'transferring',
    streams: [
      { streamId: 'video', bytes: 400 },
      { streamId: 'audio', bytes: 10, totalBytes: 20 },
    ],
  },
  { itemId: 'a', sequence: 2, phase: 'postprocessing' },
  { itemId: 'b', sequence: 1, phase: 'failed', reason: 'unavailable' },
  {
    itemId: 'a',
    sequence: 3,
    phase: 'saved',
    asset: { assetId: 'asset', name: 'clip.mp4', mime: 'video/mp4', size: 420 },
  },
];
const update = (item: DownloadItem) =>
  downloadUpdateSchema.parse({ ...scope, item });
describe('download_media wire contract', () => {
  it('round trips a progress snapshot plus subsequent journal updates', () => {
    const first = applyDownloadUpdate(initial, update(events[0]!));
    expect(applyDownloadUpdate(first, update(events[0]!))).toBe(first);
    const restored = downloadActivitySchema.parse(
      JSON.parse(JSON.stringify(first)),
    );
    expect(restored).toEqual(first);
    const live = events.reduce(
      (s, i) => applyDownloadUpdate(s, update(i)),
      initial,
    );
    expect(
      events
        .slice(1)
        .reduce((s, i) => applyDownloadUpdate(s, update(i)), restored),
    ).toEqual(live);
    expect(live.items.map((i) => i.phase)).toEqual(['saved', 'failed']);
    expect(
      applyDownloadUpdate(live, update({ ...events[0]!, sequence: 10 })),
    ).toBe(live);
    const retry = { ...initial, batchId: 'retry' };
    expect(applyDownloadUpdate(retry, update(events[0]!))).toBe(retry);
    expect(
      applyDownloadUpdate(retry, { ...update(events[0]!), batchId: 'retry' })
        .items[0],
    ).toEqual(events[0]);
  });
  it('requires final asset metadata and denies model destination authority', () => {
    expect(
      downloadUpdateSchema.safeParse({
        ...scope,
        item: { itemId: 'a', sequence: 1, phase: 'saved' },
      }).success,
    ).toBe(false);
    const input = { urls: ['https://example.org/video'], maxHeight: 2160 };
    expect(
      downloadMediaInputSchema.safeParse({ ...input, destination: '/tmp' })
        .success,
    ).toBe(false);
    expect(
      downloadMediaOperationSchema.safeParse({ ...scope, input }).success,
    ).toBe(false);
    expect(
      downloadMediaOperationSchema.parse({
        ...scope,
        input,
        destinationGrantId: 'a7a51dbe-bdf2-427d-b320-691d6872ef52',
      }).input,
    ).toEqual(input);
  });
});
