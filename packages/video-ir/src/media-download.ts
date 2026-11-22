import { z } from 'zod';

export const DOWNLOAD_MEDIA_TOOL = 'download_media';
export const MEDIA_DOWNLOAD_ACTIVITY = 'media-download';
/**
 * The destination question's text. The server stores the answer under it and
 * the client recognizes the question by it, so both import this one value.
 */
export const DOWNLOAD_DESTINATION_QUESTION =
  'Where should the videos be saved?';
const id = z.string().min(1).max(256);
const count = z.number().int().nonnegative();
const scope = { taskId: id, runId: id, toolCallId: id, batchId: id };

// Model-facing input: there is deliberately no host path, grant, or CLI passthrough.
export const downloadMediaInputSchema = z.strictObject({
  urls: z
    .array(z.url({ protocol: /^https?$/ }))
    .min(1)
    .max(20),
  maxHeight: z.number().int().positive().max(8640).optional(),
});
// Trusted runner input. A grant ID is a reference to check, not proof of authority.
export const downloadMediaOperationSchema = z.strictObject({
  version: z.literal(1),
  ...scope,
  destinationGrantId: z.uuid(),
  input: downloadMediaInputSchema,
});
export type DownloadMediaInput = z.infer<typeof downloadMediaInputSchema>;
export type DownloadMediaOperation = z.infer<
  typeof downloadMediaOperationSchema
>;

const identity = { itemId: id, sequence: count };
const stream = z.strictObject({
  streamId: id,
  bytes: count,
  totalBytes: count.optional(),
  estimatedTotalBytes: count.optional(),
  bytesPerSecond: z.number().nonnegative().optional(),
  etaSeconds: z.number().nonnegative().optional(),
});
export const downloadAssetSchema = z.strictObject({
  assetId: id,
  /**
   * The task library file this asset names, so the Files panel and the card
   * show one file. Absent on assets saved before it was recorded; their
   * `assetId` is the library file id.
   */
  libraryFileId: id.optional(),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(128),
  size: count,
});
export const downloadItemSchema = z.discriminatedUnion('phase', [
  z.strictObject({ ...identity, phase: z.literal('waiting') }),
  z.strictObject({ ...identity, phase: z.literal('queued') }),
  z.strictObject({
    ...identity,
    phase: z.literal('transferring'),
    streams: z.array(stream).min(1).max(32).refine(uniqueStreams),
  }),
  z.strictObject({ ...identity, phase: z.literal('postprocessing') }),
  z.strictObject({
    ...identity,
    phase: z.literal('saved'),
    asset: downloadAssetSchema,
  }),
  z.strictObject({
    ...identity,
    phase: z.literal('failed'),
    reason: z.enum(['unavailable', 'denied', 'limit', 'collision', 'download']),
  }),
  z.strictObject({ ...identity, phase: z.literal('cancelled') }),
]);
function uniqueStreams(streams: { streamId: string }[]): boolean {
  return new Set(streams.map((s) => s.streamId)).size === streams.length;
}
const envelope = { version: z.literal(1), ...scope };
export const downloadActivitySchema = z.strictObject({
  ...envelope,
  items: z
    .array(downloadItemSchema)
    .min(1)
    .max(20)
    .refine(
      (items) => new Set(items.map((i) => i.itemId)).size === items.length,
    ),
});
export const downloadUpdateSchema = z.strictObject({
  ...envelope,
  item: downloadItemSchema,
});
export type DownloadAsset = z.infer<typeof downloadAssetSchema>;
export type DownloadItem = z.infer<typeof downloadItemSchema>;
export type DownloadActivity = z.infer<typeof downloadActivitySchema>;
export type DownloadUpdate = z.infer<typeof downloadUpdateSchema>;

export function isTerminalDownloadItem(item: DownloadItem): boolean {
  return (
    item.phase === 'saved' ||
    item.phase === 'failed' ||
    item.phase === 'cancelled'
  );
}

// Both live and journal consumers reduce complete per-item replacements. A retry
// starts a fresh batch; no late update can resurrect a terminal item in the old one.
export function applyDownloadUpdate(
  state: DownloadActivity,
  update: DownloadUpdate,
): DownloadActivity {
  if (
    state.batchId !== update.batchId ||
    state.taskId !== update.taskId ||
    state.runId !== update.runId ||
    state.toolCallId !== update.toolCallId
  )
    return state;
  const index = state.items.findIndex(
    (item) => item.itemId === update.item.itemId,
  );
  const prior = state.items[index];
  if (
    !prior ||
    isTerminalDownloadItem(prior) ||
    update.item.sequence <= prior.sequence
  )
    return state;
  return {
    ...state,
    items: state.items.map((item, i) => (i === index ? update.item : item)),
  };
}

/**
 * The card a batch belongs to.
 *
 * The batch id is minted once, when the model asks to download, and the answer
 * that starts the download is a later run. Keying the card by the run would
 * give the first turn's waiting card and the download's progress card two
 * identities; the batch and its tool call are what stay the same.
 */
export function downloadActivityId(
  activity: Pick<DownloadActivity, 'taskId' | 'toolCallId' | 'batchId'>,
): string {
  return `${MEDIA_DOWNLOAD_ACTIVITY}:${JSON.stringify([activity.taskId, activity.toolCallId, activity.batchId])}`;
}

/** Accept a wire snapshot only for this task/card. Merge by item, not timestamp:
 * a replay or slow producer cannot undo a sibling's newer or terminal state. */
export function reconcileDownloadSnapshot(
  taskId: string,
  messageId: string,
  prior: unknown,
  content: unknown,
): DownloadActivity | undefined {
  const next = downloadActivitySchema.safeParse(content);
  if (
    !next.success ||
    next.data.taskId !== taskId ||
    downloadActivityId(next.data) !== messageId
  )
    return;
  if (prior === undefined) return next.data;
  const existing = downloadActivitySchema.safeParse(prior);
  if (
    !existing.success ||
    existing.data.taskId !== taskId ||
    downloadActivityId(existing.data) !== messageId
  )
    return;
  // The continuation that reports progress runs under a new run id; the batch
  // and tool call are the identity that must match, so the merge carries the
  // new run forward rather than rejecting it.
  const base = { ...existing.data, runId: next.data.runId };
  return next.data.items.reduce(
    (state, item) => applyDownloadUpdate(state, { ...next.data, item }),
    base,
  );
}
