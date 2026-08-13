import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteImportedOverlayItem,
  IMPORTED_OVERLAY_FILE,
  IMPORTED_OVERLAY_SCHEMA_ID,
  ImportedOverlayError,
  getImportedOverlayAsset,
  listImportedOverlayItems,
  saveImportedOverlayItem,
} from '@/shared/video/overlays/imported-items';

const GIF_1X1_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function lottieBase64(): string {
  return Buffer.from(
    JSON.stringify({ v: '5.7.0', layers: [] }),
    'utf8',
  ).toString('base64');
}

describe('imported overlay items', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imported-overlays-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('saves, lists, persists, and deletes a local GIF import', async () => {
    const saved = await saveImportedOverlayItem({
      name: 'Reaction burst',
      fileName: 'burst.gif',
      mimeType: 'image/gif',
      dataBase64: GIF_1X1_BASE64,
    });

    expect(saved).toMatchObject({
      id: expect.stringMatching(/^import:/),
      name: 'Reaction burst',
      kind: 'gif',
      source: {
        kind: 'local-upload',
        fileName: 'burst.gif',
        mimeType: 'image/gif',
      },
      provenance: {
        kind: 'import',
        provider: 'local',
        createdAt: expect.any(String),
      },
    });
    await expect(
      fs.access(path.join(workDir, saved.relativePath)),
    ).resolves.toBeUndefined();

    const listed = await listImportedOverlayItems();
    expect(listed).toEqual([saved]);
    await expect(getImportedOverlayAsset(saved.id)).resolves.toMatchObject({
      item: saved,
      bytes: expect.any(Buffer),
    });

    const raw = JSON.parse(
      await fs.readFile(path.join(workDir, IMPORTED_OVERLAY_FILE), 'utf8'),
    );
    expect(raw.schema).toBe(IMPORTED_OVERLAY_SCHEMA_ID);

    expect(await deleteImportedOverlayItem(saved.id)).toBe(true);
    expect(await listImportedOverlayItems()).toEqual([]);
    await expect(
      fs.access(path.join(workDir, saved.relativePath)),
    ).rejects.toThrow();
    expect(await deleteImportedOverlayItem(saved.id)).toBe(false);
  });

  it('saves a Lottie JSON import with local provenance', async () => {
    const saved = await saveImportedOverlayItem({
      name: 'Pulse',
      fileName: 'pulse.lottie',
      mimeType: 'application/lottie+json',
      dataBase64: lottieBase64(),
    });

    expect(saved.kind).toBe('lottie');
    expect(saved.relativePath).toMatch(/\.json$/);
    expect(saved.source.mimeType).toBe('application/lottie+json');
    expect(saved.provenance.provider).toBe('local');
  });

  it('rejects unsupported, malformed, and invalid-base64 imports', async () => {
    await expect(
      saveImportedOverlayItem({
        name: 'Nope',
        fileName: 'nope.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('hello', 'utf8').toString('base64'),
      }),
    ).rejects.toThrow(ImportedOverlayError);

    await expect(
      saveImportedOverlayItem({
        name: 'Bad Lottie',
        fileName: 'bad.json',
        mimeType: 'application/json',
        dataBase64: Buffer.from('{"layers":[]}', 'utf8').toString('base64'),
      }),
    ).rejects.toThrow(/Invalid Lottie/);

    await expect(
      saveImportedOverlayItem({
        name: 'Bad base64',
        fileName: 'bad.gif',
        mimeType: 'image/gif',
        dataBase64: '%%%not-base64%%%',
      }),
    ).rejects.toThrow(/Invalid base64/);
  });

  it('ignores manifest entries with unsafe relative paths', async () => {
    await fs.writeFile(
      path.join(workDir, IMPORTED_OVERLAY_FILE),
      JSON.stringify({
        schema: IMPORTED_OVERLAY_SCHEMA_ID,
        imports: [
          {
            id: 'import:bad',
            name: 'Bad path',
            kind: 'gif',
            relativePath: '../outside.gif',
            source: {
              kind: 'local-upload',
              fileName: 'bad.gif',
              mimeType: 'image/gif',
              sizeBytes: 42,
            },
            provenance: {
              kind: 'import',
              provider: 'local',
              createdAt: '2026-07-08T00:00:00.000Z',
            },
          },
        ],
      }),
      'utf8',
    );

    expect(await listImportedOverlayItems()).toEqual([]);
  });
});
