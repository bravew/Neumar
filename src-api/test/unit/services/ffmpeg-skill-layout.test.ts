/**
 * Installed-resource layout verification for the managed FFmpeg skill.
 *
 * The Tauri bundle maps `../skills/**` to `RESOURCES_DIR/_up_/skills`, with a
 * plain `skills` directory as a fallback. This test proves the packaged
 * layout resolves without a real Tauri build: it points `RESOURCES_DIR` at a
 * temporary bundle that carries the vendored `skills/ffmpeg` payload under
 * each layout, then asserts the same discovery path the API daemon uses.
 *
 * The app-data and legacy `~/.claude/skills` roots are pointed at empty
 * temporary directories so the bundled tier is the only place the loader can
 * find `ffmpeg`, keeping the resolution deterministic on developer machines
 * that already have an installed copy.
 */
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getBundledSkillsDir,
  resetBundledSkillsDirCache,
} from '@/config/constants';

import {
  clearFfmpegContractCache,
  loadFfmpegContract,
  resolveFfmpegSkillDir,
} from '@/shared/services/ffmpeg-skill';

const REPO_FFMPEG_SKILL = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'skills',
  'ffmpeg',
);

const tempDirs: string[] = [];

let originalResourcesDir: string | undefined;
let originalBundledSkillsDir: string | undefined;
let originalAppDataDir: string | undefined;
let originalHome: string | undefined;

beforeEach(async () => {
  originalResourcesDir = process.env.RESOURCES_DIR;
  originalBundledSkillsDir = process.env.NEUMAR_BUNDLED_SKILLS_DIR;
  originalAppDataDir = process.env.NEUMAR_APP_DATA_DIR;
  originalHome = process.env.HOME;

  // Isolate every discovery root except the RESOURCES_DIR bundle under test.
  const appDataDir = await mkdtemp(join(tmpdir(), 'neuma-layout-app-'));
  const homeDir = await mkdtemp(join(tmpdir(), 'neuma-layout-home-'));
  tempDirs.push(appDataDir, homeDir);
  process.env.NEUMAR_APP_DATA_DIR = appDataDir;
  process.env.HOME = homeDir;
  delete process.env.NEUMAR_BUNDLED_SKILLS_DIR;

  resetBundledSkillsDirCache();
  clearFfmpegContractCache();
});

afterEach(async () => {
  restoreEnv('RESOURCES_DIR', originalResourcesDir);
  restoreEnv('NEUMAR_BUNDLED_SKILLS_DIR', originalBundledSkillsDir);
  restoreEnv('NEUMAR_APP_DATA_DIR', originalAppDataDir);
  restoreEnv('HOME', originalHome);
  resetBundledSkillsDirCache();
  clearFfmpegContractCache();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Build a temporary Tauri-style bundle carrying the vendored ffmpeg payload.
 * `layout: 'up'` produces `_up_/skills/ffmpeg`; `'direct'` produces
 * `skills/ffmpeg`. Returns the bundle root (the value for RESOURCES_DIR).
 */
async function buildBundle(layout: 'up' | 'direct'): Promise<string> {
  const bundle = await mkdtemp(join(tmpdir(), 'neuma-ffmpeg-layout-'));
  tempDirs.push(bundle);
  const skillDir =
    layout === 'up'
      ? join(bundle, '_up_', 'skills', 'ffmpeg')
      : join(bundle, 'skills', 'ffmpeg');
  await mkdir(dirname(skillDir), { recursive: true });
  await cp(REPO_FFMPEG_SKILL, skillDir, { recursive: true });
  return bundle;
}

describe('packaged ffmpeg skill resource layout', () => {
  it('resolves the skill and its contract from the _up_/skills layout', async () => {
    const bundle = await buildBundle('up');
    process.env.RESOURCES_DIR = bundle;
    resetBundledSkillsDirCache();

    const bundled = getBundledSkillsDir();
    expect(bundled).toBe(join(bundle, '_up_', 'skills'));

    const skillDir = await resolveFfmpegSkillDir();
    expect(skillDir).toBe(join(bundle, '_up_', 'skills', 'ffmpeg'));

    const loaded = await loadFfmpegContract();
    expect(loaded.skillDir).toBe(skillDir);
    expect(loaded.contract.contract_version).toBe('1.0');
    expect(loaded.tools.size).toBe(42);
  });

  it('falls back to the direct skills layout when _up_/skills is absent', async () => {
    const bundle = await buildBundle('direct');
    process.env.RESOURCES_DIR = bundle;
    resetBundledSkillsDirCache();

    const bundled = getBundledSkillsDir();
    expect(bundled).toBe(join(bundle, 'skills'));

    const skillDir = await resolveFfmpegSkillDir();
    expect(skillDir).toBe(join(bundle, 'skills', 'ffmpeg'));

    const loaded = await loadFfmpegContract();
    expect(loaded.skillDir).toBe(skillDir);
    expect(loaded.contract.contract_version).toBe('1.0');
    expect(loaded.tools.size).toBe(42);
  });
});
