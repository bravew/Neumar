/**
 * Regression coverage for #226. The local archive default root must resolve
 * through getAppDir() so NEUMAR_APP_DATA_DIR moves it, and an archive written
 * under the pre-rebrand `.neuma` directory must still be found.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalArchiveAdapter } from '@/shared/services/publish/destinations/local-archive';
import type {
  LegContext,
  PublishLegInput,
} from '@/shared/services/publish/types';

const SHA = 'a'.repeat(64);

function legInput(sourcePath: string, sizeBytes: number): PublishLegInput {
  return {
    jobId: 'job-226',
    legId: 'leg-226',
    source: { path: sourcePath, sha256: SHA, sizeBytes, mime: 'video/mp4' },
    metadata: { title: 'Launch Video' },
    destination: {
      kind: 'local-archive',
      connectionId: 'local',
      approvalRequired: false,
    },
  };
}

const legContext: LegContext = { recordChunkProgress: () => undefined };

function archiveTargetDir(rootDir: string): string {
  return join(rootDir, '2026', '05', '06', `${SHA.slice(0, 8)}-launch-video`);
}

describe('LocalArchiveAdapter honours NEUMAR_APP_DATA_DIR (#226)', () => {
  let dataDir: string;
  let scratch: string;
  let sourcePath: string;
  /** A stand-in for the developer's real home; nothing may land here. */
  let fakeHome: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;
  const originalHome = process.env.HOME;
  const originalOverride = process.env.NEUMAR_APP_DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'neumar-226-archive-data-'));
    scratch = mkdtempSync(join(tmpdir(), 'neumar-226-archive-src-'));
    fakeHome = mkdtempSync(join(tmpdir(), 'neumar-226-archive-home-'));
    process.env.HOME = fakeHome;
    process.env.NEUMAR_APP_DATA_DIR = dataDir;
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    sourcePath = join(scratch, 'video.mp4');
    writeFileSync(sourcePath, 'hello');
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalOverride === undefined) delete process.env.NEUMAR_APP_DATA_DIR;
    else process.env.NEUMAR_APP_DATA_DIR = originalOverride;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('writes the archive under the override, not the home directory', async () => {
    const adapter = new LocalArchiveAdapter({
      now: () => new Date('2026-05-06T12:00:00.000Z'),
    });

    const plan = await adapter.plan(legInput(sourcePath, 5));
    expect(plan.targetPath).toBe(archiveTargetDir(join(dataDir, 'archive')));

    await adapter.upload(legInput(sourcePath, 5), legContext);

    expect(
      existsSync(join(archiveTargetDir(join(dataDir, 'archive')), 'video.mp4')),
    ).toBe(true);
    expect(readdirSync(fakeHome)).toEqual([]);
  });

  it('migrates an existing .neuma archive to the new root on first write', async () => {
    const legacyRoot = join(dataDir, '.neuma', 'archive');
    const legacyArtifactDir = archiveTargetDir(legacyRoot);
    mkdirSync(legacyArtifactDir, { recursive: true });
    writeFileSync(join(legacyArtifactDir, 'old.mp4'), 'old');

    const adapter = new LocalArchiveAdapter({
      now: () => new Date('2026-05-06T12:00:00.000Z'),
    });
    await adapter.upload(legInput(sourcePath, 5), legContext);

    // The legacy tree moved intact, so an archive published before the
    // rebrand is still reachable at the new root.
    expect(existsSync(join(legacyRoot, 'old.mp4'))).toBe(false);
    expect(
      existsSync(join(archiveTargetDir(join(dataDir, 'archive')), 'old.mp4')),
    ).toBe(true);
    expect(
      existsSync(join(archiveTargetDir(join(dataDir, 'archive')), 'video.mp4')),
    ).toBe(true);
  });

  it('never touches a caller-injected root', async () => {
    const injectedRoot = join(scratch, 'injected');
    const legacyRoot = join(dataDir, '.neuma', 'archive');
    mkdirSync(archiveTargetDir(legacyRoot), { recursive: true });
    writeFileSync(join(archiveTargetDir(legacyRoot), 'old.mp4'), 'old');

    const adapter = new LocalArchiveAdapter({
      rootDir: injectedRoot,
      now: () => new Date('2026-05-06T12:00:00.000Z'),
    });
    await adapter.upload(legInput(sourcePath, 5), legContext);

    expect(existsSync(join(archiveTargetDir(legacyRoot), 'old.mp4'))).toBe(
      true,
    );
    expect(existsSync(join(injectedRoot, '2026'))).toBe(true);
    expect(readdirSync(fakeHome)).toEqual([]);
  });
});
