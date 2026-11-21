import { z } from 'zod';

export const DOWNLOAD_MEDIA_TOOL = 'download_media';
export const MEDIA_DOWNLOAD_ACTIVITY = 'media-download';
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
