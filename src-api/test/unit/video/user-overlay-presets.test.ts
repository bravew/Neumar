import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteUserOverlayPreset,
  listUserOverlayPresets,
  saveUserOverlayPreset,
  USER_OVERLAY_PRESET_FILE,
  UserOverlayPresetError,
} from '@/shared/video/overlays/user-presets';

describe('user overlay presets ("My overlays")', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-overlays-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('saves, lists, and deletes a derived preset (round trip)', async () => {
    const saved = await saveUserOverlayPreset({
      name: 'Green highlight',
      basePresetId: 'html.marker-highlight',
      controls: { text: 'Big news', color: '#008000' },
      loop: 'loop',
    });
    expect(saved.id).toMatch(/^user:/);
    expect(saved.basePresetId).toBe('html.marker-highlight');

    const listed = await listUserOverlayPresets();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: 'Green highlight',
      controls: { text: 'Big news', color: '#008000' },
      loop: 'loop',
    });

    // persisted to the workspace file, so it survives a restart
    const raw = JSON.parse(
      await fs.readFile(path.join(workDir, USER_OVERLAY_PRESET_FILE), 'utf8'),
    );
    expect(raw.schema).toBe('neuma.video.user-overlay-presets.v1');

    expect(await deleteUserOverlayPreset(saved.id)).toBe(true);
    expect(await listUserOverlayPresets()).toEqual([]);
    expect(await deleteUserOverlayPreset(saved.id)).toBe(false);
  });

  it('rejects unknown base presets and invalid controls', async () => {
    await expect(
      saveUserOverlayPreset({
        name: 'Nope',
        basePresetId: 'html.does-not-exist',
        controls: {},
      }),
    ).rejects.toThrow(UserOverlayPresetError);
    await expect(
      saveUserOverlayPreset({
        name: 'Bad controls',
        basePresetId: 'html.marker-highlight',
        controls: { fontSize: 99999 },
      }),
    ).rejects.toThrow(/above max/);
    // asset-backed presets are not saveable bookmarks
    await expect(
      saveUserOverlayPreset({
        name: 'Gif',
        basePresetId: 'sticker.gif',
        controls: {},
      }),
    ).rejects.toThrow(/cannot be saved/);
  });

  it('returns an empty list for a corrupt store file', async () => {
    await fs.writeFile(
      path.join(workDir, USER_OVERLAY_PRESET_FILE),
      '{"schema":"wrong"}',
      'utf8',
    );
    expect(await listUserOverlayPresets()).toEqual([]);
  });
});
