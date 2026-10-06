import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'sync-builtin-skills.mjs');
const tempDirs: string[] = [];

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function runSync(appDataDir: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, NEUMAR_APP_DATA_DIR: appDataDir },
    encoding: 'utf8',
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('sync-builtin-skills', () => {
  it('copies into NEUMAR_APP_DATA_DIR and skips unchanged content', async () => {
    const appDataDir = await mkdtemp(join(tmpdir(), 'neuma-skill-sync-'));
    tempDirs.push(appDataDir);

    const first = runSync(appDataDir);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain(join(appDataDir, 'skills'));

    const installed = join(appDataDir, 'skills', 'ffmpeg', 'SKILL.md');
    const script = join(
      appDataDir,
      'skills',
      'ffmpeg',
      'scripts',
      '_contract.py',
    );
    const copied = await readFile(installed);
    const source = await readFile(
      join(REPO_ROOT, 'skills', 'ffmpeg', 'SKILL.md'),
    );
    expect(sha256(copied)).toBe(sha256(source));
    await stat(script);

    const marker = join(appDataDir, 'skills', 'unrelated', 'KEEP.md');
    await mkdir(join(appDataDir, 'skills', 'unrelated'), { recursive: true });
    await writeFile(marker, 'user owned\n');
    const before = await stat(installed);

    const second = runSync(appDataDir);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already up to date');
    const after = await stat(installed);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(marker, 'utf8')).toBe('user owned\n');

    const edited = Buffer.from(source);
    edited[edited.length - 1] =
      edited[edited.length - 1] === 0x0a ? 0x20 : 0x0a;
    await writeFile(installed, edited);
    const equalSize = await stat(installed);
    expect(equalSize.size).toBe(before.size);

    const third = runSync(appDataDir);
    expect(third.status).toBe(0);
    expect(third.stdout).toContain('synced');
    expect(sha256(await readFile(installed))).toBe(sha256(source));
    expect(await readFile(marker, 'utf8')).toBe('user owned\n');
  });
});
