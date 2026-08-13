import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { createLogger } from '@/shared/utils/logger';

import { getVideoWorkspaceRoot } from '../store';
import {
  findVividOverlayPreset as findBuiltInPreset,
  resolveVividOverlay,
} from './registry';

const logger = createLogger('VideoUserOverlayPresets');

// "My overlays": user-saved overlay presets. A saved preset is a library-side
// bookmark — a BUILT-IN base preset plus saved control values and loop mode.
// Dropped clips reference the built-in presetId, so preview, render, and the
// agent never see a user preset id; only the library rail does. This keeps
// the store data-only (same ceiling as plugin preset packs) with no new
// resolution paths.

export const USER_OVERLAY_PRESET_FILE = 'user-overlay-presets.json';

export const UserOverlayPresetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    basePresetId: z.string().min(1),
    controls: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
    loop: z.enum(['loop', 'hold', 'none']).optional(),
    createdAt: z.string().min(1),
  })
  .strict();

export type UserOverlayPreset = z.infer<typeof UserOverlayPresetSchema>;

const FileSchema = z
  .object({
    schema: z.literal('neuma.video.user-overlay-presets.v1'),
    presets: z.array(UserOverlayPresetSchema),
  })
  .strict();

function storePath(): string {
  return path.join(getVideoWorkspaceRoot(), USER_OVERLAY_PRESET_FILE);
}

export async function listUserOverlayPresets(): Promise<UserOverlayPreset[]> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = FileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn('video.user_overlay_presets.invalid_store_file', {
        path: storePath(),
      });
      return [];
    }
    return parsed.data.presets;
  } catch {
    return [];
  }
}

async function writeStore(presets: UserOverlayPreset[]): Promise<void> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(
    storePath(),
    JSON.stringify(
      { schema: 'neuma.video.user-overlay-presets.v1', presets },
      null,
      2,
    ),
    'utf8',
  );
}

export interface SaveUserOverlayPresetInput {
  name: string;
  basePresetId: string;
  controls: Record<string, string | number | boolean>;
  loop?: 'loop' | 'hold' | 'none';
}

export async function saveUserOverlayPreset(
  input: SaveUserOverlayPresetInput,
): Promise<UserOverlayPreset> {
  const base = findBuiltInPreset(input.basePresetId);
  if (!base) {
    throw new UserOverlayPresetError(
      `Unknown base preset: ${input.basePresetId}`,
      'unknown_base_preset',
    );
  }
  if (base.requiresSourceAsset) {
    throw new UserOverlayPresetError(
      'Asset-backed presets cannot be saved to the library',
      'asset_preset_not_saveable',
    );
  }
  const resolved = resolveVividOverlay({
    presetId: base.id,
    backend: base.backend,
    controls: input.controls,
  });
  if (!resolved || resolved.errors.length > 0) {
    throw new UserOverlayPresetError(
      `Invalid controls: ${resolved?.errors.join('; ') ?? 'unresolvable'}`,
      'invalid_controls',
    );
  }
  const preset: UserOverlayPreset = {
    id: `user:${randomUUID()}`,
    name: input.name.trim().slice(0, 80) || base.id,
    basePresetId: base.id,
    controls: input.controls,
    ...(input.loop ? { loop: input.loop } : {}),
    createdAt: new Date().toISOString(),
  };
  const presets = await listUserOverlayPresets();
  await writeStore([...presets, preset]);
  logger.info('video.user_overlay_presets.saved', {
    preset_id: preset.id,
    base_preset_id: base.id,
  });
  return preset;
}

export async function deleteUserOverlayPreset(id: string): Promise<boolean> {
  const presets = await listUserOverlayPresets();
  const remaining = presets.filter((preset) => preset.id !== id);
  if (remaining.length === presets.length) return false;
  await writeStore(remaining);
  logger.info('video.user_overlay_presets.deleted', { preset_id: id });
  return true;
}

export class UserOverlayPresetError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'UserOverlayPresetError';
  }
}
