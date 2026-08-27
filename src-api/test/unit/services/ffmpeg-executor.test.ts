import {
  chmodSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  clearBinaryCache,
  detectBinaries,
  validateInputFile,
  validatePath,
} from '@/shared/services/ffmpeg/executor';

let tempHome = '';

describe('ffmpeg executor path validation', () => {
  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), 'neuma-ffmpeg-paths-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
  });

  afterEach(() => {
    clearBinaryCache();
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('allows reading media from sibling session folders', () => {
    const workspace = path.join(tempHome, '_Neumar');
    const currentSession = path.join(workspace, 'sessions', 'session-current');
    const priorSession = path.join(workspace, 'sessions', 'session-prior');
    const source = path.join(priorSession, 'BLAZE_Trailer_v2.mp4');
    mkdirSync(currentSession, { recursive: true });
    mkdirSync(priorSession, { recursive: true });
    writeFileSync(source, 'video');

    expect(validateInputFile(source, currentSession)).toBe(source);
  });

  it('allows reading media from sibling session attachments', () => {
    const workspace = path.join(tempHome, '_Neumar');
    const currentSession = path.join(workspace, 'sessions', 'session-current');
    const sourceDir = path.join(
      workspace,
      'sessions',
      'session-prior',
      'attachments',
    );
    const source = path.join(sourceDir, 'card.jpg');
    mkdirSync(currentSession, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(source, 'image');

    expect(validateInputFile(source, currentSession)).toBe(source);
  });

  it('does not allow reading arbitrary files from the workspace root', () => {
    const workspace = path.join(tempHome, '_Neumar');
    const currentSession = path.join(workspace, 'sessions', 'session-current');
    const source = path.join(workspace, 'loose.mp4');
    mkdirSync(currentSession, { recursive: true });
    writeFileSync(source, 'video');
    setSetting('workDir', workspace);

    expect(() => validateInputFile(source, currentSession)).toThrow(
      /outside the allowed read directories/,
    );
  });

  it('keeps output writes confined to the current session', () => {
    const workspace = path.join(tempHome, '_Neumar');
    const currentSession = path.join(workspace, 'sessions', 'session-current');
    const priorSession = path.join(workspace, 'sessions', 'session-prior');
    mkdirSync(currentSession, { recursive: true });
    mkdirSync(priorSession, { recursive: true });

    expect(() =>
      validatePath(path.join(priorSession, 'result.mp4'), currentSession),
    ).toThrow(/outside the allowed write directories/);
  });

  // A project may reference a master the user keeps outside the workspace.
  // `resolveProjectAssetPath` admits it under the linked-source rules; without
  // the opt-in below the executor re-checked it against the workspace alone
  // and rejected the file, so rendering external footage always failed.
  describe('external masters', () => {
    function externalMaster(): { workspace: string; source: string } {
      const workspace = path.join(tempHome, '_Neumar');
      const outside = path.join(tempHome, 'ExternalDrive', 'ChongQing');
      const source = path.join(outside, 'DJI_0002.mp4');
      mkdirSync(workspace, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(source, 'video');
      setSetting('workDir', workspace);
      return { workspace, source };
    }

    it('reads an external master when the caller opts in', () => {
      const { workspace, source } = externalMaster();

      expect(
        validateInputFile(source, workspace, { allowExternalMedia: true }),
      ).toBe(realpathSync(source));
    });

    it('still refuses the same path without the opt-in', () => {
      const { workspace, source } = externalMaster();

      expect(() => validateInputFile(source, workspace)).toThrow(
        /outside the allowed read directories/,
      );
    });

    it('does not let the opt-in reach a credential directory', () => {
      const { workspace } = externalMaster();
      const sshDir = path.join(tempHome, '.ssh');
      const key = path.join(sshDir, 'id_ed25519');
      mkdirSync(sshDir, { recursive: true });
      writeFileSync(key, 'PRIVATE KEY');

      expect(() =>
        validateInputFile(key, workspace, { allowExternalMedia: true }),
      ).toThrow(/sensitive path/);
    });

    it('does not let the opt-in turn a directory into an input', () => {
      const { workspace } = externalMaster();
      const dir = path.join(tempHome, 'ExternalDrive', 'ChongQing');

      expect(() =>
        validateInputFile(dir, workspace, { allowExternalMedia: true }),
      ).toThrow(/must be a file/);
    });

    it('never relaxes writes', () => {
      const { workspace } = externalMaster();
      const outside = path.join(tempHome, 'ExternalDrive', 'out.mp4');

      expect(() =>
        validatePath(outside, workspace, 'write', { allowExternalMedia: true }),
      ).toThrow(/outside the allowed write directories/);
    });
  });
});

describe('ffmpeg executor binary detection', () => {
  let tempDir = '';
  let binDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'neuma-ffmpeg-bin-'));
    binDir = path.join(tempDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    vi.stubEnv('PATH', '/usr/bin:/bin');
    clearBinaryCache();
  });

  afterEach(() => {
    clearBinaryCache();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
    binDir = '';
  });

  it('finds ffmpeg in a configured search directory even when it is not on PATH', () => {
    const ffmpegPath = writeExecutable(
      'ffmpeg',
      'printf "ffmpeg version 6.1-test\\n"',
    );
    const ffprobePath = writeExecutable(
      'ffprobe',
      'printf "ffprobe version 6.1-test\\n"',
    );
    vi.stubEnv('NEUMA_FFMPEG_SEARCH_PATHS', binDir);

    const bins = detectBinaries();

    expect(bins).toMatchObject({
      ffmpegPath,
      ffprobePath,
      source: 'system',
      version: 'ffmpeg version 6.1-test',
    });
  });

  it('honors explicit binary paths when PATH is empty', () => {
    const ffmpegPath = writeExecutable(
      'custom-ffmpeg',
      'printf "ffmpeg version explicit\\n"',
    );
    const ffprobePath = writeExecutable(
      'custom-ffprobe',
      'printf "ffprobe version explicit\\n"',
    );
    vi.stubEnv('PATH', '');
    vi.stubEnv('NEUMA_FFMPEG_PATH', ffmpegPath);
    vi.stubEnv('NEUMA_FFPROBE_PATH', ffprobePath);

    const bins = detectBinaries();

    expect(bins).toMatchObject({
      ffmpegPath,
      ffprobePath,
      source: 'system',
      version: 'ffmpeg version explicit',
    });
  });

  function writeExecutable(name: string, body: string): string {
    const filePath = path.join(binDir, name);
    writeFileSync(filePath, `#!/bin/sh\n${body}\n`);
    chmodSync(filePath, 0o755);
    return filePath;
  }
});
