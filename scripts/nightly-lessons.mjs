#!/usr/bin/env node
/**
 * Nightly lessons review.
 *
 * Reads the first-parent commits on the current checkout's HEAD after the
 * `reviewed-through` cursor in LESSONS.md, correlates them with evidence, and
 * writes a report. With `--apply` it also writes the LESSONS.md changes the
 * evidence supports, so a later step can open a human-reviewed PR.
 *
 *   node scripts/nightly-lessons.mjs --repo owner/name --out <dir> [options]
 *
 *   --repo <owner/name>     Repository to read check runs and issues from.
 *   --out <dir>             Directory for report.md and report.json.
 *   --head <sha>            Range end. Defaults to the checkout's HEAD.
 *   --date <YYYY-MM-DD>     UTC review date. Defaults to today (UTC).
 *   --lessons <path>        LESSONS.md path. Defaults to ./LESSONS.md.
 *   --proposals <path>      JSON array of explicit, validated proposals.
 *   --apply                 Write LESSONS.md. Without it nothing is edited.
 *   --catch-up              Report the whole range, write no lesson, and move
 *                           the cursor to the head. Used once to start from an
 *                           agreed cursor, and on request after a long gap.
 *
 * Exit codes: 0 complete, 2 incomplete read (cursor not advanced), 1 usage or
 * internal error. An incomplete read never edits LESSONS.md.
 */

import { collectRange } from './lib/nightly-lessons/collect.mjs';
import { isUtcDate, parseCursor } from './lib/nightly-lessons/lessons-file.mjs';
import { renderReport, reviewRange } from './lib/nightly-lessons/review.mjs';
import { createSource } from './lib/nightly-lessons/source.mjs';

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

function fail(message) {
  console.error(`nightly-lessons: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    out: { type: 'string' },
    head: { type: 'string' },
    date: { type: 'string' },
    lessons: { type: 'string', default: 'LESSONS.md' },
    proposals: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'catch-up': { type: 'boolean', default: false },
  },
});

if (!values.repo) fail('--repo is required');
if (!values.out) fail('--out is required');
const date = values.date ?? new Date().toISOString().slice(0, 10);
if (!isUtcDate(date)) fail(`--date is not a UTC date: ${date}`);

const head =
  values.head ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
const lessonsPath = path.resolve(values.lessons);
if (!existsSync(lessonsPath)) fail(`LESSONS file not found: ${lessonsPath}`);
const lessonsText = readFileSync(lessonsPath, 'utf-8');
const cursor = parseCursor(lessonsText);
if (!cursor) fail('LESSONS.md line 1 has no `reviewed-through` cursor');

let extraProposals = [];
if (values.proposals) {
  const parsed = JSON.parse(
    readFileSync(path.resolve(values.proposals), 'utf-8'),
  );
  if (!Array.isArray(parsed)) fail('--proposals must be a JSON array');
  extraProposals = parsed;
}

const source = createSource({ repo: values.repo, cwd: process.cwd() });
const collected = await collectRange(source, { cursor: cursor.sha, head });
const outcome = reviewRange({
  lessonsText,
  collected,
  reviewDate: date,
  extraProposals,
  catchUp: values['catch-up'],
});

const outDir = path.resolve(values.out);
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'report.md'),
  renderReport({ date, collected, outcome, catchUp: values['catch-up'] }),
);
writeFileSync(
  path.join(outDir, 'report.json'),
  `${JSON.stringify({ date, collected, outcome: { ...outcome, text: undefined } }, null, 2)}\n`,
);

if (values.apply && collected.complete && outcome.changed) {
  writeFileSync(lessonsPath, outcome.text);
}

const actionable = collected.complete && outcome.changed;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `complete=${collected.complete}\nactionable=${actionable}\nhead=${head}\ncommits=${collected.range.commits}\n`,
  );
}

console.log(
  collected.complete
    ? `nightly-lessons: ${collected.range.commits} commit(s), ${outcome.applied.length} lesson change(s), actionable=${actionable}`
    : `nightly-lessons: INCOMPLETE, cursor not advanced: ${collected.reasons.join('; ')}`,
);
process.exit(collected.complete ? 0 : 2);
