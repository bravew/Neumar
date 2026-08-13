import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteUserOverlayStyle,
  exportUserOverlayStyles,
  importUserOverlayStyles,
  listUserOverlayStyles,
  saveUserOverlayStyle,
  USER_OVERLAY_STYLE_FILE,
  USER_OVERLAY_STYLE_SCHEMA_ID,
  UserOverlayStyleError,
} from '@/shared/video/overlays/user-styles';

describe('user overlay styles', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-overlay-styles-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('saves, lists, deletes, and persists a full overlay style', async () => {
    const saved = await saveUserOverlayStyle({
      name: 'Pinned highlight',
      basePresetId: 'html.marker-highlight',
      controls: { text: 'Big news', color: '#008000', fontSize: 72 },
      loop: 'hold',
      transform: { positionX: 0.25, positionY: 0.7, scale: 1.1, opacity: 0.9 },
      keyframes: [
        {
          property: 'positionX',
          keys: [
            { atMs: 0, value: 0.25 },
            { atMs: 600, value: 0.55, interp: 'smooth' },
          ],
        },
      ],
      tags: ['callout', 'highlight', 'callout'],
      provenance: { kind: 'saved-from-timeline', sourceId: 'clip-1' },
    });

    expect(saved.id).toMatch(/^style:/);
    expect(saved).toMatchObject({
      name: 'Pinned highlight',
      basePresetId: 'html.marker-highlight',
      controls: { text: 'Big news', color: '#008000', fontSize: 72 },
      transform: { positionX: 0.25, positionY: 0.7, scale: 1.1, opacity: 0.9 },
      tags: ['callout', 'highlight'],
      taste: { intent: 'annotation' },
      provenance: {
        kind: 'saved-from-timeline',
        sourceId: 'clip-1',
        createdAt: expect.any(String),
      },
    });

    const listed = await listUserOverlayStyles();
    expect(listed).toEqual([saved]);

    const raw = JSON.parse(
      await fs.readFile(path.join(workDir, USER_OVERLAY_STYLE_FILE), 'utf8'),
    );
    expect(raw.schema).toBe(USER_OVERLAY_STYLE_SCHEMA_ID);

    expect(await deleteUserOverlayStyle(saved.id)).toBe(true);
    expect(await listUserOverlayStyles()).toEqual([]);
    expect(await deleteUserOverlayStyle(saved.id)).toBe(false);
  });

  it('exports and imports the style file as a JSON round trip', async () => {
    const saved = await saveUserOverlayStyle({
      name: 'Soft CTA',
      basePresetId: 'html.subscribe-button',
      controls: { text: 'FOLLOW', accentColor: '#ef4444' },
      loop: 'loop',
      provenance: { kind: 'agent', sourceId: 'turn-1' },
    });
    const exported = await exportUserOverlayStyles();
    expect(exported).toEqual({
      schema: USER_OVERLAY_STYLE_SCHEMA_ID,
      styles: [saved],
    });

    await fs.rm(path.join(workDir, USER_OVERLAY_STYLE_FILE), { force: true });
    expect(await listUserOverlayStyles()).toEqual([]);

    expect(await importUserOverlayStyles(exported)).toEqual([saved]);
    expect(await listUserOverlayStyles()).toEqual([saved]);
  });

  it('rejects unknown bases, invalid controls, and invalid keyframes', async () => {
    await expect(
      saveUserOverlayStyle({
        name: 'Nope',
        basePresetId: 'html.nope',
        controls: {},
        provenance: { kind: 'saved-from-timeline' },
      }),
    ).rejects.toThrow(UserOverlayStyleError);

    await expect(
      saveUserOverlayStyle({
        name: 'Bad controls',
        basePresetId: 'html.marker-highlight',
        controls: { fontSize: 99999 },
        provenance: { kind: 'saved-from-timeline' },
      }),
    ).rejects.toThrow(/above max/);

    await expect(
      saveUserOverlayStyle({
        name: 'Bad keyframes',
        basePresetId: 'html.marker-highlight',
        controls: {},
        keyframes: [
          {
            property: 'opacity',
            keys: [{ atMs: 0, value: 2 }],
          },
        ],
        provenance: { kind: 'saved-from-timeline' },
      }),
    ).rejects.toThrow(/Invalid overlay style input/);
  });
});
