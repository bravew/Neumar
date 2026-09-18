import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { referenceFingerprint } from '@/shared/video/reference/fingerprint';
import {
  assertSafeReferenceId,
  ensureReferenceDir,
  readReferenceEnvelope,
  validatedReferencePath,
  writeReferenceEnvelope,
  writeReferenceMediaFile,
} from '@/shared/video/reference/store';
import { createProject, getVideoReferenceDir } from '@/shared/video/store';
import type {
  ReferenceArtifactEnvelope,
  ReferenceProbe,
} from '@/shared/video/types';

describe('video reference store', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-reference-store-'),
    );
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('rejects traversal, absolute paths, and unsafe ids', async () => {
    const project = await createProject({
      name: 'Reference store',
      template: 'explainer',
    });

    expect(() => assertSafeReferenceId('../etc')).toThrow(
      /Invalid video reference id/,
    );
    expect(() => assertSafeReferenceId('/abs/path')).toThrow(
      /Invalid video reference id/,
    );
    expect(() => assertSafeReferenceId('AB')).toThrow(
      /Invalid video reference id/,
    );
    expect(() => getVideoReferenceDir(project.id, '../etc')).toThrow(
      /Invalid video reference id/,
    );
    expect(() => getVideoReferenceDir(project.id, '/abs/path')).toThrow(
      /Invalid video reference id/,
    );

    expect(() =>
      validatedReferencePath(
        project.id,
        path.join(workDir, '..', 'escape.json'),
      ),
    ).toThrow(/outside the allowed write directories/);
  });

  it('removes the staging directory on a media write failure', async () => {
    const project = await createProject({
      name: 'Reference staging',
      template: 'explainer',
    });
    const archive = await ensureReferenceDir(project.id, 'ref-abc123');
    const dest = path.join(archive, 'media', 'source.mp4');
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      writeReferenceMediaFile(project.id, dest, Buffer.from('bytes')),
    ).rejects.toThrow('disk full');

    const leftover = await fs.readdir(path.join(archive, 'media'));
    expect(leftover.some((name) => name.startsWith('.stage-'))).toBe(false);
    await expect(fs.stat(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('round-trips a probe envelope', async () => {
    const project = await createProject({
      name: 'Reference envelope',
      template: 'explainer',
    });
    await ensureReferenceDir(project.id, 'ref-abc123');
    const envelope: ReferenceArtifactEnvelope<ReferenceProbe> = {
      kind: 'probe',
      referenceId: 'ref-abc123',
      sourceFingerprint: referenceFingerprint({ contentHash: 'abc' }),
      derivedFrom: {},
      generatedAt: '2026-09-15T00:00:00.000Z',
      producer: 'ffmpeg',
      data: {
        durationMs: 8000,
        width: 640,
        height: 360,
        frameRate: { num: 24, den: 1 },
        hasAudio: false,
        audioTrackCount: 0,
        containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
      },
    };

    await writeReferenceEnvelope(project.id, envelope);
    await expect(
      readReferenceEnvelope<ReferenceProbe>(project.id, 'ref-abc123', 'probe'),
    ).resolves.toEqual(envelope);
  });

  it('changes when upstream input changes and is key-order stable', () => {
    const stable = referenceFingerprint({
      contentHash: 'abc',
      durationMs: 1000,
    });
    expect(referenceFingerprint({ durationMs: 1000, contentHash: 'abc' })).toBe(
      stable,
    );
    expect(
      referenceFingerprint({ contentHash: 'def', durationMs: 1000 }),
    ).not.toBe(stable);
  });
});
