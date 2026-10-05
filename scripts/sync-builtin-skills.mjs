#!/usr/bin/env node

/**
 * Sync built-in skills from the repo's `skills/` directory into the app data
 * skills directory so they are resolvable by `pinnedSkills: [...]` at runtime.
 *
 * The destination follows `NEUMAR_APP_DATA_DIR` when it is set, matching the
 * API daemon. Otherwise it is `~/.<slug>/skills/` from branding.json.
 *
 * A destination file is written only when its bytes differ from the source.
 * Equal-size edits are therefore updated. A file whose content already matches
 * is left untouched, so a repeated run is a no-op.
 *
 * User-owned overrides are preserved by not deleting anything this script did
 * not just compare: a destination file that differs is overwritten with the
 * bundled source (that is the development sync), and files that exist only in
 * the destination are left in place. Removing stale bundled-owned files is
 * deferred; there is no separate ownership inventory in this release.
 *
 * Wired into `predev:api` and `prebuild`. Does not install into provider
 * global skill directories such as `~/.claude/skills`.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function readSlug() {
  const brandingPath = join(ROOT, 'branding.json');
  if (!existsSync(brandingPath)) return '.claude';
  try {
    const { slug } = JSON.parse(readFileSync(brandingPath, 'utf8'));
    if (typeof slug === 'string' && slug.length > 0) return `.${slug}`;
  } catch {
    /* fallthrough */
  }
  return '.claude';
}

function resolveTargetSkillsDir() {
  const override = process.env.NEUMAR_APP_DATA_DIR?.trim();
  const appDir = override || join(homedir(), readSlug());
  return join(appDir, 'skills');
}

function sameContent(src, dst) {
  const source = readFileSync(src);
  const destination = readFileSync(dst);
  if (source.length !== destination.length) return false;
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  return hash(source) === hash(destination);
}

function copyTree(src, dst) {
  const stats = statSync(src);
  if (!stats.isDirectory()) {
    mkdirSync(dirname(dst), { recursive: true });
    if (existsSync(dst) && sameContent(src, dst)) return false;
    writeFileSync(dst, readFileSync(src));
    return true;
  }
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(src)) {
    if (copyTree(join(src, entry), join(dst, entry))) copied += 1;
  }
  return copied > 0;
}

function main() {
  const repoSkills = join(ROOT, 'skills');
  if (!existsSync(repoSkills)) {
    console.log('[sync-skills] no skills/ directory in repo, skipping');
    return;
  }
  const targetSkillsDir = resolveTargetSkillsDir();
  mkdirSync(targetSkillsDir, { recursive: true });

  const entries = readdirSync(repoSkills);
  let touched = 0;
  for (const name of entries) {
    const src = join(repoSkills, name);
    if (!statSync(src).isDirectory()) continue;
    const dst = join(targetSkillsDir, name);
    if (copyTree(src, dst)) touched += 1;
  }
  console.log(
    `[sync-skills] ${touched > 0 ? `synced ${touched} skill(s) to ` : 'already up to date in '}${targetSkillsDir}`,
  );
}

main();
