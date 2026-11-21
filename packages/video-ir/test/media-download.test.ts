import { describe, expect, it } from 'vitest';

import {
  applyDownloadUpdate,
  downloadActivityId,
  downloadActivitySchema,
  downloadMediaInputSchema,
  downloadMediaOperationSchema,
  downloadUpdateSchema,
  reconcileDownloadSnapshot,
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

describe('reconcileDownloadSnapshot', () => {
  const cardId = downloadActivityId(initial);
  const live = events.reduce(
    (state, item) => applyDownloadUpdate(state, update(item)),
    initial,
  );

  it('accepts a first snapshot for this task and card', () => {
    expect(
      reconcileDownloadSnapshot('task', cardId, undefined, initial),
    ).toEqual(initial);
  });

  it('lands a resumed batch on the card that asked, under its new run', () => {
    // The answer that starts the download arrives in a later run than the turn
    // that asked for one. Same task, tool call and batch mean the same card.
    const resumed = downloadActivitySchema.parse({
      ...scope,
      runId: 'run-after-answer',
      items: [{ ...events[0]!, sequence: 1 }],
    });
    const merged = reconcileDownloadSnapshot('task', cardId, initial, resumed);
    expect(downloadActivityId(merged!)).toBe(cardId);
    expect(merged?.runId).toBe('run-after-answer');
    expect(merged?.items[0]?.phase).toBe('transferring');
  });

  it('rejects a snapshot for another task or another card', () => {
    expect(
      reconcileDownloadSnapshot('other', cardId, undefined, initial),
    ).toBeUndefined();
    expect(
      reconcileDownloadSnapshot(
        'task',
        'media-download:wrong',
        undefined,
        initial,
      ),
    ).toBeUndefined();
    expect(
      reconcileDownloadSnapshot('task', cardId, undefined, { junk: true }),
    ).toBeUndefined();
  });

  it('keeps a terminal sibling when a stale replay arrives', () => {
    const stale = downloadActivitySchema.parse({
      ...scope,
      items: [
        { ...events[0]!, sequence: 1 },
        { itemId: 'b', sequence: 0, phase: 'waiting' },
      ],
    });
    expect(reconcileDownloadSnapshot('task', cardId, live, stale)).toEqual(
      live,
    );
  });

  it('advances only the items a newer snapshot moved on', () => {
    const next = downloadActivitySchema.parse({
      ...scope,
      items: [events[0]!, { itemId: 'b', sequence: 0, phase: 'waiting' }],
    });
    const merged = reconcileDownloadSnapshot('task', cardId, initial, next);
    expect(merged?.items.map((item) => item.phase)).toEqual([
      'transferring',
      'waiting',
    ]);
  });

  it('refuses to merge into an unparseable or foreign prior', () => {
    expect(
      reconcileDownloadSnapshot('task', cardId, { junk: true }, initial),
    ).toBeUndefined();
    expect(
      reconcileDownloadSnapshot('other', cardId, live, initial),
    ).toBeUndefined();
  });
});
