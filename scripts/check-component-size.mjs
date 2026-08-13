#!/usr/bin/env node
/**
 * Component-size guard.
 *
 * Scans `src/components/**\/*.tsx` and fails when:
 *   1. A non-allowlisted file exceeds the default cap (350 lines).
 *   2. An allowlisted file grows beyond its current line count.
 *
 * The allowlist (`scripts/component-size-allowlist.json`) is a temporary
 * holding pen — the goal is to shrink it over time. Each entry has
 * `current` (the line count we tolerate today) and `target` (the goal).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMPONENT_ROOT = join(ROOT, 'src', 'components');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'component-size-allowlist.json');
const DEFAULT_MAX_LINES = 350;

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

  console.log(
    `Component size check passed (${files.length} files scanned, ${Object.keys(allowlist).length} allowlisted).`,
  );
}

main().catch((err) => {
  console.error('Component size check crashed:', err);
  process.exit(2);
});
