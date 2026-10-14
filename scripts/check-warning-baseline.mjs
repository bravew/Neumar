#!/usr/bin/env node
/**
 * Warning and suppression baseline gate.
 *
 * `pnpm validate` passes with 453 frontend correctness warnings, and the pass
 * bar is not the quality bar. This gate freezes that debt in
 * `scripts/lint-warning-baseline.json` and fails when a change grows it:
 *
 *   1. A new lint warning, per file and per rule.
 *   2. A new `eslint-disable` / `oxlint-disable` suppression comment.
 *
 * Either can be allowed by a reviewed exception in the baseline file that
 * carries an owner, a reason, an expiry date, and a regression test. Removing
 * warnings is always allowed; the run prints how to record the reduction with
 * `--update` so the same change lowers the baseline.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_ROOT = join(ROOT, 'src');
const BASELINE_PATH = join(ROOT, 'scripts', 'lint-warning-baseline.json');
const OXLINT_BIN =
  process.env.OXLINT_BIN?.trim() ||
  join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'oxlint.cmd' : 'oxlint',
  );
const OXLINT_CONFIG =
  process.env.OXLINT_CONFIG?.trim() || join(ROOT, '.oxlintrc.json');
const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const SUPPRESSION_DIRECTIVE =
  /\b(?:eslint|oxlint)-disable(?:-next-line|-line)?\b(.*)$/;
/** Comments spell plugin rules `react-hooks/exhaustive-deps`; oxlint reports
 *  them as `react-hooks(exhaustive-deps)`. Normalize so both sides compare. */
const PLUGIN_RULE = /^([a-z0-9-]+)\/(.+)$/;
const EXCEPTION_KINDS = new Set(['warning', 'suppression']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BASELINE_VERSION = 1;

const update = process.argv.includes('--update');

function toPosix(p) {
  return p.split(sep).join('/');
}

function bump(counts, file, rule) {
  const rules = counts.get(file) ?? new Map();
  rules.set(rule, (rules.get(rule) ?? 0) + 1);
  counts.set(file, rules);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (entry.isFile()) {
      out.push(p);
    }
  }
  return out;
}

function runOxlint() {
  const bin = existsSync(OXLINT_BIN) ? OXLINT_BIN : 'oxlint';
  const result = spawnSync(
    bin,
    ['src/', '--format=json', '--config', OXLINT_CONFIG],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.error) {
    console.error(
      `Warning baseline gate could not run ${bin}: ${result.error.message}`,
    );
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(result.stdout ?? '');
  } catch {
    console.error(
      'Warning baseline gate could not parse the oxlint JSON report.',
    );
    console.error(result.stderr ?? '');
    process.exit(2);
  }

  const warnings = new Map();
  const errors = [];
  for (const diagnostic of report.diagnostics ?? []) {
    const file = toPosix(
      relative(ROOT, resolve(ROOT, diagnostic.filename ?? '')),
    );
    if (diagnostic.severity === 'warning') {
      bump(warnings, file, diagnostic.code ?? '(unknown)');
    } else {
      errors.push(`${file}: ${diagnostic.code ?? '(unknown)'}`);
    }
  }

  return { warnings, errors };
}

function normalizeRule(rule) {
  const match = PLUGIN_RULE.exec(rule);
  return match ? `${match[1]}(${match[2]})` : rule;
}

async function collectSuppressions() {
  const counts = new Map();
  for (const file of await walk(SRC_ROOT)) {
    if (!SCANNED_EXTENSIONS.has(extname(file))) continue;
    const rel = toPosix(relative(ROOT, file));
    const text = await readFile(file, 'utf8');
    for (const line of text.split('\n')) {
      const match = SUPPRESSION_DIRECTIVE.exec(line);
      if (!match) continue;
      const rest = match[1].split('--')[0].replace(/\*\/\s*$/, '');
      const rules = rest
        .split(',')
        .map((rule) => normalizeRule(rule.trim()))
        .filter(Boolean);
      for (const rule of rules.length > 0 ? rules : ['(all)']) {
        bump(counts, rel, rule);
      }
    }
  }
  return counts;
}

function toPlain(counts) {
  const plain = {};
  for (const file of [...counts.keys()].sort()) {
    plain[file] = {};
    for (const rule of [...counts.get(file).keys()].sort()) {
      plain[file][rule] = counts.get(file).get(rule);
    }
  }
  return plain;
}

function fromPlain(plain) {
  const counts = new Map();
  for (const [file, rules] of Object.entries(plain ?? {})) {
    for (const [rule, count] of Object.entries(rules ?? {})) {
      counts.set(file, counts.get(file) ?? new Map());
      counts.get(file).set(rule, count);
    }
  }
  return counts;
}

function total(counts) {
  let sum = 0;
  for (const rules of counts.values()) {
    for (const count of rules.values()) sum += count;
  }
  return sum;
}

function validateExceptions(exceptions, failures) {
  const allowances = new Map();
  const today = new Date().toISOString().slice(0, 10);

  for (const [index, exception] of (exceptions ?? []).entries()) {
    const label = `exceptions[${index}]`;
    const missing = [
      'file',
      'rule',
      'owner',
      'reason',
      'expires',
      'regressionTest',
    ].filter(
      (field) =>
        typeof exception?.[field] !== 'string' ||
        exception[field].trim() === '',
    );
    if (missing.length > 0) {
      failures.push(
        `${label}: missing ${missing.join(', ')}. A reviewed exception needs an owner, a reason, an expiry date, and a regression test.`,
      );
      continue;
    }
    if (!EXCEPTION_KINDS.has(exception.kind)) {
      failures.push(`${label}: kind must be "warning" or "suppression".`);
      continue;
    }
    if (!DATE_PATTERN.test(exception.expires)) {
      failures.push(`${label}: expires must be a YYYY-MM-DD date.`);
      continue;
    }
    if (exception.expires < today) {
      failures.push(
        `${label}: expired on ${exception.expires}. Renew it with a new date or fix the underlying issue.`,
      );
      continue;
    }
    if (!existsSync(join(ROOT, exception.regressionTest))) {
      failures.push(
        `${label}: regression test ${exception.regressionTest} does not exist.`,
      );
      continue;
    }
    const key = `${exception.kind}\u0000${exception.file}\u0000${exception.rule}`;
    allowances.set(key, (allowances.get(key) ?? 0) + 1);
  }

  return allowances;
}

function allowedFor(allowances, kind, file, rule) {
  return allowances.get(`${kind}\u0000${file}\u0000${rule}`) ?? 0;
}

function compare(kind, actual, baseline, allowances) {
  const growth = [];
  for (const [file, rules] of actual) {
    for (const [rule, count] of rules) {
      const base = baseline.get(file)?.get(rule) ?? 0;
      const allowed = base + allowedFor(allowances, kind, file, rule);
      if (count > allowed) {
        growth.push({ file, rule, count, allowed, base });
      }
    }
  }

  const reductions = [];
  for (const [file, rules] of baseline) {
    for (const [rule, count] of rules) {
      const now = actual.get(file)?.get(rule) ?? 0;
      if (now < count) reductions.push({ file, rule, count: now, base: count });
    }
  }

  return { growth, reductions };
}

function formatRuleTotals(counts) {
  const rules = new Map();
  for (const perFile of counts.values()) {
    for (const [rule, count] of perFile) {
      rules.set(rule, (rules.get(rule) ?? 0) + count);
    }
  }
  return [...rules.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rule, count]) => `${count} ${rule}`)
    .join(', ');
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeBaseline(warnings, suppressions) {
  const baseline = {
    version: BASELINE_VERSION,
    note: 'Frozen frontend lint debt. Growth fails `pnpm check:warning-baseline`; record reductions with `node scripts/check-warning-baseline.mjs --update`.',
    warnings: toPlain(warnings),
    suppressions: toPlain(suppressions),
    exceptions: [],
  };
  const existing = await readBaseline();
  baseline.exceptions = existing?.exceptions ?? [];
  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Wrote ${toPosix(relative(ROOT, BASELINE_PATH))}: ${total(warnings)} warnings, ${total(suppressions)} suppressions.`,
  );
}

async function main() {
  const { warnings, errors } = runOxlint();
  const suppressions = await collectSuppressions();

  if (errors.length > 0) {
    console.error('Warning baseline gate FAILED: oxlint reported errors.');
    for (const error of errors.slice(0, 20)) console.error(`  - ${error}`);
    console.error('  Run `pnpm lint` and fix the errors first.');
    process.exit(1);
  }

  if (update) {
    await writeBaseline(warnings, suppressions);
    return;
  }

  const baseline = await readBaseline();
  if (!baseline) {
    console.error(
      `Warning baseline gate FAILED: ${toPosix(relative(ROOT, BASELINE_PATH))} is missing.`,
    );
    console.error(
      '  Create it with `node scripts/check-warning-baseline.mjs --update`.',
    );
    process.exit(1);
  }

  const failures = [];
  const allowances = validateExceptions(baseline.exceptions, failures);

  const warningDiff = compare(
    'warning',
    warnings,
    fromPlain(baseline.warnings),
    allowances,
  );
  const suppressionDiff = compare(
    'suppression',
    suppressions,
    fromPlain(baseline.suppressions),
    allowances,
  );

  for (const { file, rule, count, allowed, base } of warningDiff.growth) {
    failures.push(
      `${file}: ${rule} grew from ${base} to ${count} (allowed ${allowed}). Fix the warning or add a reviewed exception to scripts/lint-warning-baseline.json.`,
    );
  }
  for (const { file, rule, count, allowed, base } of suppressionDiff.growth) {
    failures.push(
      `${file}: suppression for ${rule} grew from ${base} to ${count} (allowed ${allowed}). Remove the suppression, fix the underlying issue, or add a reviewed exception to scripts/lint-warning-baseline.json.`,
    );
  }

  if (failures.length > 0) {
    console.error('Warning baseline gate FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `Warning baseline gate passed (${total(warnings)} warnings in ${warnings.size} files: ${formatRuleTotals(warnings)}).`,
  );
  console.log(
    `  ${total(suppressions)} lint suppression comments across ${suppressions.size} files.`,
  );

  const reductions = [
    ...warningDiff.reductions.map((entry) => ({ kind: 'warning', ...entry })),
    ...suppressionDiff.reductions.map((entry) => ({
      kind: 'suppression',
      ...entry,
    })),
  ];
  if (reductions.length > 0) {
    console.log(
      `  Baseline can be lowered: ${reductions.length} file/rule ${reductions.length === 1 ? 'entry is' : 'entries are'} below the baseline (${reductions
        .slice(0, 5)
        .map(
          (entry) =>
            `${entry.file} ${entry.rule} ${entry.base} to ${entry.count}`,
        )
        .join(
          '; ',
        )}). Run \`node scripts/check-warning-baseline.mjs --update\` in the same change to record the reduction.`,
    );
  }
}

main().catch((err) => {
  console.error('Warning baseline gate crashed:', err);
  process.exit(2);
});
