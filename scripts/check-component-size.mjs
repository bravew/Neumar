#!/usr/bin/env node
/**
 * Component-size guard.
 *
 * Scans `src/components/**\/*.tsx` and fails when:
 *   1. A non-allowlisted file exceeds the default cap (350 lines).
 *   2. An allowlisted file grows beyond its current line count.
 *   3. An allowlist `current` ceiling is raised above the base branch value.
 *
 * The allowlist (`scripts/component-size-allowlist.json`) is a temporary
 * holding pen — the goal is to shrink it over time. Each entry has
 * `current` (the line count we tolerate today) and `target` (the goal).
 * Raising a ceiling is not a fix; split the component instead. Lowering or
 * removing an entry is always allowed.
 */

import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMPONENT_ROOT = join(ROOT, 'src', 'components');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'component-size-allowlist.json');
const ALLOWLIST_REPO_PATH = 'scripts/component-size-allowlist.json';
const DEFAULT_MAX_LINES = 350;

/**
 * Base ref for the ceiling comparison. `BASE_REF` lets CI name the pull
 * request base; `GITHUB_BASE_REF` is the GitHub-provided fallback; locally the
 * default is `origin/main`. An explicitly named base that cannot be resolved
 * is an error, not a reason to skip the comparison.
 */
function baseRef() {
  const explicit = process.env.BASE_REF?.trim();
  if (explicit) return { ref: explicit, required: true };
  const fromGithub = process.env.GITHUB_BASE_REF?.trim();
  if (fromGithub) return { ref: `origin/${fromGithub}`, required: true };
  return { ref: 'origin/main', required: false };
}

/**
 * Reads the allowlist as committed on the base ref. Returns null when an
 * optional base ref or the file is unavailable (shallow clone, new branch,
 * first introduction). A required base ref that cannot be resolved is a
 * failure, because skipping the comparison would let a raised ceiling pass; a
 * resolved ref with no allowlist file is still allowed.
 */
function readBaseAllowlist(failures) {
  const { ref, required } = baseRef();
  const resolved = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  if (resolved.error || resolved.status !== 0) {
    if (required) {
      failures.push(
        `Cannot resolve base ref ${ref}. Fetch it (\`git fetch origin\`) or unset BASE_REF so the check falls back to origin/main.`,
      );
    }
    return null;
  }
  const result = spawnSync('git', ['show', `${ref}:${ALLOWLIST_REPO_PATH}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return null;
  try {
    return { ref, allowlist: JSON.parse(result.stdout) };
  } catch {
    return null;
  }
}

function findCeilingIncreases(base, current) {
  const increases = [];
  for (const [file, entry] of Object.entries(current)) {
    const baseEntry = base[file];
    if (!baseEntry) continue;
    const baseCurrent = baseEntry.current;
    const currentCurrent = entry.current;
    if (typeof baseCurrent !== 'number' || typeof currentCurrent !== 'number') {
      continue;
    }
    if (currentCurrent > baseCurrent) {
      increases.push({ file, from: baseCurrent, to: currentCurrent });
    }
  }
  return increases;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

async function countLines(filePath) {
  const buf = await readFile(filePath);
  let lines = 0;
  for (const byte of buf) if (byte === 0x0a) lines++;
  if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) lines++;
  return lines;
}

function toPosix(p) {
  return p.split(sep).join('/');
}

async function main() {
  let allowlist = {};
  try {
    const raw = await readFile(ALLOWLIST_PATH, 'utf8');
    allowlist = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await stat(COMPONENT_ROOT);
  const files = await walk(COMPONENT_ROOT);
  const violations = [];

  for (const file of files) {
    const rel = toPosix(relative(ROOT, file));
    const lines = await countLines(file);
    const allowed = allowlist[rel];

    if (allowed) {
      if (lines > allowed.current) {
        violations.push(
          `${rel}: ${lines} lines exceeds allowlist ceiling ${allowed.current} (target ${allowed.target ?? DEFAULT_MAX_LINES})`,
        );
      }
    } else if (lines > DEFAULT_MAX_LINES) {
      violations.push(
        `${rel}: ${lines} lines exceeds default cap ${DEFAULT_MAX_LINES}. Either split the component or add it to scripts/component-size-allowlist.json with a target.`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('Component size check FAILED:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  const baseFailures = [];
  const base = readBaseAllowlist(baseFailures);
  if (baseFailures.length > 0) {
    console.error('Component size check FAILED:');
    for (const f of baseFailures) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (base) {
    const increases = findCeilingIncreases(base.allowlist, allowlist);
    if (increases.length > 0) {
      console.error('Component size check FAILED: allowlist ceiling raised.');
      for (const { file, from, to } of increases) {
        console.error(
          `  - ${file}: ceiling raised from ${from} to ${to} against ${base.ref}. Raising a ceiling is not a fix; split the component.`,
        );
      }
      process.exit(1);
    }
  }

  console.log(
    `Component size check passed (${files.length} files scanned, ${Object.keys(allowlist).length} allowlisted${base ? `, ceilings compared against ${base.ref}` : ', no base allowlist to compare'}).`,
  );
}

main().catch((err) => {
  console.error('Component size check crashed:', err);
  process.exit(2);
});
