/**
 * Server-side helpers + Zod schema for the live-artifact wire protocol.
 * Every emit is parsed through `ArtifactEventSchema` so a misbehaving
 * adapter cannot write a malformed event into the bus.
 */

import { z } from 'zod';

import { liveArtifactQuietCloseRegistry } from '@/shared/services/design-mode/artifact-quiet-close';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ArtifactEvents');

export const ARTIFACT_KINDS = [
  'html',
  'svg',
  'react',
  'mermaid',
  'chart',
  'code',
  'markdown',
  'question-form',
  'direction-picker',
  'todo-list',
  'media-progress',
] as const;

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);

const ArtifactSnapshotSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    messageId: z.string().min(1),
    kind: ArtifactKindSchema,
    title: z.string(),
    version: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
    content: z.string(),
    language: z.string().optional(),
  })
  .strict();

const DiffPatchSchema = z
  .object({
    op: z.enum(['eq', 'ins', 'del']),
    text: z.string(),
  })
  .strict();

export const ArtifactEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('artifact.create'),
      artifact: ArtifactSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('artifact.append'),
      id: z.string().min(1),
      version: z.number().int().positive(),
      chunk: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('artifact.replace'),
      id: z.string().min(1),
      version: z.number().int().positive(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('artifact.patch'),
      id: z.string().min(1),
      version: z.number().int().positive(),
      patches: z.array(DiffPatchSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal('artifact.delete'),
      id: z.string().min(1),
    })
    .strict(),
]);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactSnapshot = z.infer<typeof ArtifactSnapshotSchema>;
export type DiffPatch = z.infer<typeof DiffPatchSchema>;
export type ArtifactEvent = z.infer<typeof ArtifactEventSchema>;

export function publishArtifactEvent(
  taskId: string,
  event: ArtifactEvent,
): void {
  const parsed = ArtifactEventSchema.safeParse(event);
  if (!parsed.success) {
    logger.warn('Dropping malformed artifact event', {
      taskId,
      issues: parsed.error.issues,
    });
    return;
  }
  taskEventBus.publish(taskId, parsed.data);
}

interface CreateInput {
  taskId: string;
  messageId: string;
  id: string;
  kind: ArtifactKind;
  title: string;
  content?: string;
  language?: string;
}

export function publishArtifactCreate(input: CreateInput): ArtifactSnapshot {
  const now = Date.now();
  const snapshot: ArtifactSnapshot = {
    id: input.id,
    taskId: input.taskId,
    messageId: input.messageId,
    kind: input.kind,
    title: input.title,
    version: 1,
    createdAt: now,
    updatedAt: now,
    content: input.content ?? '',
    ...(input.language !== undefined ? { language: input.language } : {}),
  };
  publishArtifactEvent(input.taskId, {
    type: 'artifact.create',
    artifact: snapshot,
  });
  liveArtifactQuietCloseRegistry.registerDeliverable(input.taskId);
  return snapshot;
}

export function publishArtifactAppend(
  taskId: string,
  id: string,
  version: number,
  chunk: string,
): void {
  publishArtifactEvent(taskId, { type: 'artifact.append', id, version, chunk });
}

export function publishArtifactReplace(
  taskId: string,
  id: string,
  version: number,
  content: string,
): void {
  publishArtifactEvent(taskId, {
    type: 'artifact.replace',
    id,
    version,
    content,
  });
}

export function publishArtifactPatch(
  taskId: string,
  id: string,
  version: number,
  patches: DiffPatch[],
): void {
  publishArtifactEvent(taskId, {
    type: 'artifact.patch',
    id,
    version,
    patches,
  });
}

export function publishArtifactDelete(taskId: string, id: string): void {
  publishArtifactEvent(taskId, { type: 'artifact.delete', id });
}
