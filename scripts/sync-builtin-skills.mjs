#!/usr/bin/env node

/**
 * Sync built-in skills (currently: video-editing) from the repo's `skills/`
 * directory into the app data dir (`~/.<slug>/skills/`) so they are
 * resolvable by `pinnedSkills: [...]` at runtime.
 *
 * Without this, the SKILL.md loader logs "Pinned skill not found" and the
 * agent runs without its editing knowledge.
 *
 * Wired into `predev:api` and `prebuild`. Safe to re-run (only overwrites
 * older or differently-sized files).
 */

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

function copyTree(src, dst) {
  const stats = statSync(src);
  if (!stats.isDirectory()) {
    mkdirSync(dirname(dst), { recursive: true });
    if (existsSync(dst)) {
      const existing = statSync(dst);
      if (existing.size === stats.size && existing.mtimeMs >= stats.mtimeMs) {
        return false;
      }
    }
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
  const targetSkillsDir = join(homedir(), readSlug(), 'skills');
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
