#!/usr/bin/env node
import { flag, listCaseFiles, readCaseMeta } from './eval-utils.js';

/**
 * eval-select — decide which eval case files to run for a CI invocation.
 *
 * Modes:
 *   --all              return every case file
 *   --tier <t>         filter to a single tier (gate|periodic)
 *   --case <id>        select only one case by id
 *   --base=<ref>       compare diff against this git ref (otherwise origin/main)
 *   --json             emit JSON output
 */
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const EVAL_DIRS = ['src-api/test/evals'];
const GLOBAL_TOUCHFILES = [
  'src-api/src/core/agent/**',
  'src-api/src/shared/db/migrations/**',
  'src-api/src/shared/observability/**',
  'src-api/test/helpers/**',
  'src-api/test/evals/registry.ts',
  'package.json',
  'src-api/package.json',
];

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const allMode = args.includes('--all');
const baseArg = args.find((arg) => arg.startsWith('--base='));
const tierFilter = flag(args, '--tier');
const caseFilter = flag(args, '--case');

function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function changedFiles() {
  const base = baseArg?.slice('--base='.length);
  let mergeBase = base;
  if (!mergeBase) {
    try {
      mergeBase = git(['merge-base', 'HEAD', 'origin/main']);
    } catch {
      try {
        mergeBase = git(['rev-parse', 'HEAD~1']);
      } catch {
        return null;
      }
    }
  }
  const out = git(['diff', '--name-only', mergeBase, 'HEAD']);
  return out ? out.split('\n').filter(Boolean) : [];
}

function toRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => toRegex(pattern).test(file));
}

const cases = listCaseFiles(ROOT, EVAL_DIRS).map((file) =>
  readCaseMeta(ROOT, file),
);

let selected;
let reason;

if (caseFilter) {
  selected = cases.filter((c) => c.id === caseFilter);
  reason = `--case ${caseFilter}`;
} else if (allMode) {
  selected = cases;
  reason = '--all';
} else {
  const changed = changedFiles();
  const undeterminable = changed === null;
  const runAll =
    undeterminable ||
    (changed?.some((file) => matchesAny(file, GLOBAL_TOUCHFILES)) ?? false);
  if (runAll) {
    selected = cases;
    reason = undeterminable
      ? 'changed-files-undeterminable'
      : 'global-touchfile-changed';
  } else {
    selected = cases.filter(
      (c) =>
        c.touchfiles.length > 0 &&
        changed.some((f) => matchesAny(f, c.touchfiles)),
    );
    reason = `diff-against-${baseArg ?? 'origin/main'}`;
  }
}

if (tierFilter) selected = selected.filter((c) => c.tier === tierFilter);

if (cases.length === 0) {
  const message = 'No eval cases registered. This is a Phase 8 regression.';
  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({ error: message, selected: [], count: 0 }, null, 2)}\n`,
    );
  } else {
    console.error(message);
  }
  process.exit(1);
}

const result = {
  reason,
  selected: selected.map((c) => ({ id: c.id, file: c.file, tier: c.tier })),
  count: selected.length,
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(`Selection mode: ${reason}`);
  for (const c of selected) console.log(`${c.tier}\t${c.id}\t${c.file}`);
}
