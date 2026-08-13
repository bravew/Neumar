import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { KeyframeTrackSchema, type VividOverlayStyle } from '@neumar/video-ir';
import { z } from 'zod';

import { createLogger } from '@/shared/utils/logger';

import { getVideoWorkspaceRoot } from '../store';
import {
  findVividOverlayPreset as findBuiltInPreset,
  resolveVividOverlay,
} from './registry';

const logger = createLogger('VideoUserOverlayStyles');

export const USER_OVERLAY_STYLE_FILE = 'user-overlay-styles.json';
export const USER_OVERLAY_STYLE_SCHEMA_ID =
  'neuma.video.user-overlay-styles.v1';

const ControlValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const StyleTransformSchema = z
  .object({
    scale: z.number().finite().optional(),
    scaleX: z.number().finite().optional(),
    scaleY: z.number().finite().optional(),
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
    opacity: z.number().finite().optional(),
    rotation: z.number().finite().optional(),
  })
  .strict();

const StyleRestraintSchema = z
  .object({
    maxPerScene: z.number().int().positive().optional(),
    maxSimultaneous: z.number().int().positive().optional(),
    loopPolicy: z.enum(['none', 'single-ambient', 'manual']).optional(),
  })
  .strict();

const StyleMotionTokensSchema = z
  .object({
    duration: z.enum(['fast', 'base', 'slow', 'deliberate']).optional(),
    easing: z
      .enum([
        'ease-out',
        'ease-in-out',
        'linear',
        'spring-soft',
        'spring-snappy',
      ])
      .optional(),
  })
  .strict();

const StyleTasteSchema = z
  .object({
    intent: z.enum([
      'annotation',
      'ambient',
      'emphasis',
      'entrance',
      'feedback',
      'frame',
      'progress',
      'text-kinetic',
    ]),
    targets: z
      .array(
        z.enum([
          'background',
          'button',
          'frame',
          'section',
          'screen',
          'stat',
          'text',
        ]),
      )
      .min(1),
    bestFor: z.array(z.string().min(1)).min(1),
    avoidWhen: z.array(z.string().min(1)).min(1),
    restraint: StyleRestraintSchema.optional(),
    reducedMotion: z
      .enum(['crossfade', 'none', 'poster', 'scale-only'])
      .optional(),
    motionTokens: StyleMotionTokensSchema.optional(),
  })
  .strict();

const ProvenanceKindSchema = z.enum([
  'saved-from-timeline',
  'agent',
  'import',
  'video-to-template',
]);

const StyleProvenanceSchema = z
  .object({
    kind: ProvenanceKindSchema,
    sourceId: z.string().min(1).optional(),
    createdAt: z.string().min(1),
  })
  .strict();

export const UserOverlayStyleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    basePresetId: z.string().min(1),
    controls: z.record(z.string(), ControlValueSchema),
    loop: z.enum(['loop', 'hold', 'none']).optional(),
    transform: StyleTransformSchema.optional(),
    keyframes: z.array(KeyframeTrackSchema).optional(),
    tags: z.array(z.string().min(1).max(40)).max(24).optional(),
    taste: StyleTasteSchema.optional(),
    provenance: StyleProvenanceSchema,
  })
  .strict();

export const UserOverlayStyleFileSchema = z
  .object({
    schema: z.literal(USER_OVERLAY_STYLE_SCHEMA_ID),
    styles: z.array(UserOverlayStyleSchema),
  })
  .strict();

export const SaveUserOverlayStyleInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    basePresetId: z.string().min(1),
    controls: z.record(z.string(), ControlValueSchema),
    loop: z.enum(['loop', 'hold', 'none']).optional(),
    transform: StyleTransformSchema.optional(),
    keyframes: z.array(KeyframeTrackSchema).optional(),
    tags: z.array(z.string().min(1).max(40)).max(24).optional(),
    taste: StyleTasteSchema.optional(),
    provenance: z
      .object({
        kind: ProvenanceKindSchema,
        sourceId: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export type UserOverlayStyle = VividOverlayStyle;
export type SaveUserOverlayStyleInput = z.infer<
  typeof SaveUserOverlayStyleInputSchema
>;

function storePath(): string {
  return path.join(getVideoWorkspaceRoot(), USER_OVERLAY_STYLE_FILE);
}

export async function listUserOverlayStyles(): Promise<UserOverlayStyle[]> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = UserOverlayStyleFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn('video.user_overlay_styles.invalid_store_file', {
        path: storePath(),
      });
      return [];
    }
    return parsed.data.styles;
  } catch {
    return [];
  }
}

async function writeStore(styles: UserOverlayStyle[]): Promise<void> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(
    storePath(),
    JSON.stringify({ schema: USER_OVERLAY_STYLE_SCHEMA_ID, styles }, null, 2),
    'utf8',
  );
}

export async function exportUserOverlayStyles(): Promise<{
  schema: typeof USER_OVERLAY_STYLE_SCHEMA_ID;
  styles: UserOverlayStyle[];
}> {
  return {
    schema: USER_OVERLAY_STYLE_SCHEMA_ID,
    styles: await listUserOverlayStyles(),
  };
}

export async function importUserOverlayStyles(
  payload: unknown,
): Promise<UserOverlayStyle[]> {
  const parsed = UserOverlayStyleFileSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UserOverlayStyleError(
      'Invalid overlay style import file',
      'invalid_import',
    );
  }
  for (const style of parsed.data.styles) {
    validateStyleBase(style.basePresetId, style.controls);
  }
  await writeStore(parsed.data.styles);
  logger.info('video.user_overlay_styles.imported', {
    style_count: parsed.data.styles.length,
  });
  return parsed.data.styles;
}

export async function saveUserOverlayStyle(
  input: SaveUserOverlayStyleInput,
): Promise<UserOverlayStyle> {
  const parsed = SaveUserOverlayStyleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new UserOverlayStyleError(
      'Invalid overlay style input',
      'invalid_input',
    );
  }
  const data = parsed.data;
  const base = validateStyleBase(data.basePresetId, data.controls);
  const tags = normalizeTags(data.tags);
  const createdAt = new Date().toISOString();
  const style: UserOverlayStyle = {
    id: `style:${randomUUID()}`,
    name: data.name.trim().slice(0, 80) || base.id,
    basePresetId: base.id,
    controls: data.controls,
    ...(data.loop ? { loop: data.loop } : {}),
    ...(data.transform ? { transform: data.transform } : {}),
    ...(data.keyframes && data.keyframes.length > 0
      ? { keyframes: data.keyframes }
      : {}),
    ...(tags ? { tags } : {}),
    ...((data.taste ?? base.taste) ? { taste: data.taste ?? base.taste } : {}),
    provenance: {
      kind: data.provenance.kind,
      ...(data.provenance.sourceId
        ? { sourceId: data.provenance.sourceId }
        : {}),
      createdAt,
    },
  };
  const styles = await listUserOverlayStyles();
  await writeStore([...styles, style]);
  logger.info('video.user_overlay_styles.saved', {
    style_id: style.id,
    base_preset_id: base.id,
  });
  return style;
}

export async function deleteUserOverlayStyle(id: string): Promise<boolean> {
  const styles = await listUserOverlayStyles();
  const remaining = styles.filter((style) => style.id !== id);
  if (remaining.length === styles.length) return false;
  await writeStore(remaining);
  logger.info('video.user_overlay_styles.deleted', { style_id: id });
  return true;
}

function validateStyleBase(
  basePresetId: string,
  controls: SaveUserOverlayStyleInput['controls'],
) {
  const base = findBuiltInPreset(basePresetId);
  if (!base) {
    throw new UserOverlayStyleError(
      `Unknown base preset: ${basePresetId}`,
      'unknown_base_preset',
    );
  }
  if (base.requiresSourceAsset) {
    throw new UserOverlayStyleError(
      'Asset-backed presets cannot be saved as overlay styles',
      'asset_preset_not_saveable',
    );
  }
  const resolved = resolveVividOverlay({
    presetId: base.id,
    backend: base.backend,
    controls,
  });
  if (!resolved || resolved.errors.length > 0) {
    throw new UserOverlayStyleError(
      `Invalid controls: ${resolved?.errors.join('; ') ?? 'unresolvable'}`,
      'invalid_controls',
    );
  }
  return base;
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const normalized = [
    ...new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
  ].slice(0, 24);
  return normalized.length > 0 ? normalized : undefined;
}

export class UserOverlayStyleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'UserOverlayStyleError';
  }
}
