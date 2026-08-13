#!/usr/bin/env node
/**
 * Release script — bump version, generate changelog entry, create release commit + tag.
 *
 * Usage (local):
 *   node scripts/release.mjs patch          # 26.3.4 → 26.3.5
 *   node scripts/release.mjs minor          # 26.3.4 → 26.4.0  (new month)
 *   node scripts/release.mjs major          # 26.3.4 → 27.1.0  (new year)
 *   node scripts/release.mjs 26.3.5        # explicit version
 *   node scripts/release.mjs patch --dry-run
 *
 * In CI (release.yml) the VERSION_INPUT env var is used instead of argv.
 *
 * After this script runs:
 *   git push --follow-tags origin main
 * …which triggers build.yml to build DMG/EXE/AppImage for all platforms.
 *
 * Version format: YY.M.PATCH  (e.g. 26.3.4 = year 2026, March, patch 4)
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const versionInput =
  process.env.VERSION_INPUT ?? args.find((a) => !a.startsWith('--')) ?? 'patch';
const isDryRun = process.env.DRY_RUN === 'true' || args.includes('--dry-run');

// ── Version bump ──────────────────────────────────────────────────────────────

const pkgPath = resolve(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const currentVersion = pkg.version;

function bumpVersion(current, input) {
  // Explicit version (e.g. "26.3.5")
  if (/^\d+\.\d+\.\d+$/.test(input)) return input;

  const [major, minor, patch] = current.split('.').map(Number);
  const now = new Date();
  const year = now.getFullYear() % 100; // 2-digit
  const month = now.getMonth() + 1;

  switch (input) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${year}.${month}.0`;
    case 'major':
      return `${year + 1}.1.0`;
    default:
      throw new Error(
        `Unknown version bump type: "${input}". Use patch, minor, major, or an explicit version like 26.3.5`,
      );
  }
}

const newVersion = bumpVersion(currentVersion, versionInput);
console.log(`Version: ${currentVersion} → ${newVersion}`);

// ── Collect commits since last tag ───────────────────────────────────────────

let lastTag = null;
try {
  lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null', {
    encoding: 'utf-8',
  }).trim();
} catch {
  // No tags yet — include all commits
}

const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const rawLog = execSync(`git log ${range} --pretty=format:"%s" --no-merges`, {
  encoding: 'utf-8',
}).trim();

// ── Parse conventional commits ───────────────────────────────────────────────

const COMMIT_RE =
  /^(feat|fix|perf|refactor|docs|chore|test|style)(\([^)]+\))?(!)?:\s+(.+)$/;

function parseCommits(log) {
  const groups = { breaking: [], feat: [], fix: [], perf: [], other: [] };
  if (!log) return groups;

  for (const line of log.split('\n')) {
    const m = line.match(COMMIT_RE);
    if (!m) continue;
    const [, type, scopeRaw, breaking, desc] = m;
    const scope = scopeRaw ? scopeRaw.slice(1, -1) : null;
    const entry = scope ? `**${scope}**: ${desc}` : desc;

    if (breaking) groups.breaking.push(entry);
    else if (type === 'feat') groups.feat.push(entry);
    else if (type === 'fix') groups.fix.push(entry);
    else if (type === 'perf') groups.perf.push(entry);
    else groups.other.push(entry);
  }
  return groups;
}

function buildChangelogEntry(version, groups) {
  const today = new Date().toISOString().split('T')[0];
  let entry = `## ${version} — ${today}\n\n`;

  const section = (heading, items) =>
    items.length
      ? `### ${heading}\n${items.map((i) => `- ${i}`).join('\n')}\n\n`
      : '';

  entry += section('Breaking Changes', groups.breaking);
  entry += section('Added', groups.feat);
  entry += section('Fixed', groups.fix);
  entry += section('Performance', groups.perf);

  // Only include "other" if there's nothing more specific
  if (!groups.feat.length && !groups.fix.length && !groups.perf.length) {
    entry += section('Changed', groups.other);
  }

  if (
    !groups.breaking.length &&
    !groups.feat.length &&
    !groups.fix.length &&
    !groups.perf.length &&
    !groups.other.length
  ) {
    entry += '_No notable changes._\n\n';
  }

  return entry;
}

const commits = parseCommits(rawLog);
const changelogEntry = buildChangelogEntry(newVersion, commits);

// ── Dry run output ────────────────────────────────────────────────────────────

if (isDryRun) {
  console.log('\n─── DRY RUN ────────────────────────────────────────────');
  console.log(`New version : ${newVersion}`);
  console.log(`Last tag    : ${lastTag ?? '(none — first release)'}`);
  console.log(`Commits     : ${rawLog.split('\n').filter(Boolean).length}`);
  console.log('\nChangelog entry:\n');
  console.log(changelogEntry);
  console.log('─────────────────────────────────────────────────────────');
  process.exit(0);
}

// ── Apply version to all config files ────────────────────────────────────────

// package.json
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('  Updated package.json');

// src-tauri/tauri.conf.json
const tauriConfPath = resolve(ROOT, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));
tauriConf.version = newVersion;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log('  Updated src-tauri/tauri.conf.json');

// src-tauri/Cargo.toml — replace only the [package] version (first occurrence)
// Note: requires `m` flag so `^` matches start-of-line, not start-of-string.
const cargoPath = resolve(ROOT, 'src-tauri/Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf-8');
const updatedCargo = cargo.replace(
  /^version = "[\d.]+"/m,
  `version = "${newVersion}"`,
);
if (updatedCargo === cargo) {
  console.warn('  WARNING: Could not find version in Cargo.toml — skipping');
} else {
  writeFileSync(cargoPath, updatedCargo);
  console.log('  Updated src-tauri/Cargo.toml');
}

// ── Update CHANGELOG.md ───────────────────────────────────────────────────────

const changelogPath = resolve(ROOT, 'CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf-8');

// Insert new entry after the header block (before the first ## section)
const firstEntry = changelog.indexOf('\n## ');
if (firstEntry !== -1) {
  changelog =
    changelog.slice(0, firstEntry) +
    '\n\n' +
    changelogEntry.trimEnd() +
    changelog.slice(firstEntry);
} else {
  changelog += '\n' + changelogEntry;
}
writeFileSync(changelogPath, changelog);
console.log('  Updated CHANGELOG.md');

// ── Git commit + tag ──────────────────────────────────────────────────────────

const tag = `v${newVersion}`;
execSync(
  `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md`,
  { cwd: ROOT },
);
execSync(`git commit -m "chore(release): ${tag}"`, {
  cwd: ROOT,
  stdio: 'inherit',
});
execSync(`git tag -a "${tag}" -m "${tag}"`, { cwd: ROOT, stdio: 'inherit' });

console.log(`\n✅ Release ${tag} ready.`);
console.log(`   Push with: git push --follow-tags origin main`);
console.log(
  `   This triggers build.yml to produce DMG/EXE/AppImage for all platforms.`,
);
