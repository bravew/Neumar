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

import { APP_DIR_NAME } from '@/config/constants';

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

describe('LocalArchiveAdapter app-data isolation and legacy migration (#226)', () => {
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

  it('migrates the predecessor ~/.neuma/archive on first write with no override', async () => {
    delete process.env.NEUMAR_APP_DATA_DIR;
    const legacyRoot = join(fakeHome, '.neuma', 'archive');
    const legacyArtifactDir = archiveTargetDir(legacyRoot);
    mkdirSync(legacyArtifactDir, { recursive: true });
    writeFileSync(join(legacyArtifactDir, 'old.mp4'), 'old');
    const targetRoot = join(fakeHome, APP_DIR_NAME, 'archive');

    const adapter = new LocalArchiveAdapter({
      now: () => new Date('2026-05-06T12:00:00.000Z'),
    });
    await adapter.upload(legInput(sourcePath, 5), legContext);

    expect(existsSync(join(legacyArtifactDir, 'old.mp4'))).toBe(false);
    expect(existsSync(join(archiveTargetDir(targetRoot), 'old.mp4'))).toBe(
      true,
    );
    expect(existsSync(join(archiveTargetDir(targetRoot), 'video.mp4'))).toBe(
      true,
    );
  });

  it('leaves the home archive untouched when an app-data override is set', async () => {
    const legacyRoot = join(fakeHome, '.neuma', 'archive');
    const legacyArtifactDir = archiveTargetDir(legacyRoot);
    mkdirSync(legacyArtifactDir, { recursive: true });
    writeFileSync(join(legacyArtifactDir, 'old.mp4'), 'old');
    homedirSpy.mockClear();

    const adapter = new LocalArchiveAdapter({
      now: () => new Date('2026-05-06T12:00:00.000Z'),
    });
    await adapter.upload(legInput(sourcePath, 5), legContext);

    expect(homedirSpy).not.toHaveBeenCalled();
    expect(existsSync(join(legacyArtifactDir, 'old.mp4'))).toBe(true);
    expect(
      existsSync(join(archiveTargetDir(join(dataDir, 'archive')), 'old.mp4')),
    ).toBe(false);
    expect(
      existsSync(join(archiveTargetDir(join(dataDir, 'archive')), 'video.mp4')),
    ).toBe(true);
  });

  it('leaves the home archive untouched when a caller injects a root', async () => {
    delete process.env.NEUMAR_APP_DATA_DIR;
    const injectedRoot = join(scratch, 'injected');
    const legacyRoot = join(fakeHome, '.neuma', 'archive');
    const legacyArtifactDir = archiveTargetDir(legacyRoot);
    mkdirSync(legacyArtifactDir, { recursive: true });
    writeFileSync(join(legacyArtifactDir, 'old.mp4'), 'old');
    homedirSpy.mockClear();

    const adapter = new LocalArchiveAdapter({
      rootDir: injectedRoot,
      now: () => new Date('2026-05-06T12:00:00.000Z'),
    });
    await adapter.upload(legInput(sourcePath, 5), legContext);

    expect(homedirSpy).not.toHaveBeenCalled();
    expect(existsSync(join(legacyArtifactDir, 'old.mp4'))).toBe(true);
    expect(existsSync(join(archiveTargetDir(injectedRoot), 'old.mp4'))).toBe(
      false,
    );
    expect(existsSync(join(archiveTargetDir(injectedRoot), 'video.mp4'))).toBe(
      true,
    );
  });
});
