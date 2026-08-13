#!/usr/bin/env node
/**
 * Compare bundle-size-report.json against bundle-size-budgets.json and exit
 * non-zero on any breach. CI uses this as a regression gate.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const reportPath = process.argv[2] ?? resolve(ROOT, 'bundle-size-report.json');
const budgetsPath = resolve(ROOT, 'bundle-size-budgets.json');

let report, budgets;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (err) {
  process.stderr.write(`Cannot read ${reportPath}: ${err.message}\n`);
  process.exit(2);
}
try {
  budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
} catch (err) {
  process.stderr.write(`Cannot read ${budgetsPath}: ${err.message}\n`);
  process.exit(2);
}

const triple = report.triple;
const profile = budgets[triple];
if (!profile) {
  process.stderr.write(
    `No budget entry for triple "${triple}" in bundle-size-budgets.json\n`,
  );
  process.exit(2);
}

// Apply --with-cli budget when the cli-bundle is present in this build.
const withCli = report.distSubtrees.cliBundleBytes > 0;
const limits = withCli && profile.withCli ? profile.withCli : profile.default;

function mb(n) {
  return (n / 1_000_000).toFixed(1);
}

const checks = [
  ['app.bytes', report.app?.bytes, limits.appMaxBytes],
  ['artifacts.dmg.bytes', report.artifacts?.dmg?.bytes, limits.dmgMaxBytes],
  [
    'artifacts.exe.bytes',
    report.artifacts?.exe?.bytes,
    limits.windowsInstallerMaxBytes,
  ],
  [
    'artifacts.appImage.bytes',
    report.artifacts?.appImage?.bytes,
    limits.appImageMaxBytes,
  ],
];

let breached = 0;
process.stdout.write(
  `[size-check] triple=${triple}${withCli ? ' (--with-cli)' : ''}\n`,
);
for (const [field, actual, limit] of checks) {
  if (limit == null) continue;
  if (actual == null) continue;
  const ok = actual <= limit;
  const icon = ok ? '✓' : '✗';
  process.stdout.write(
    `  ${icon} ${field.padEnd(28)} ${mb(actual).padStart(7)} MB  ≤  ${mb(limit).padStart(7)} MB\n`,
  );
  if (!ok) breached++;
}

if (breached > 0) {
  process.stderr.write(
    `\n[size-check] FAIL: ${breached} budget(s) exceeded. Update budgets only if the increase is intentional.\n`,
  );
  process.exit(1);
}
process.stdout.write('[size-check] OK\n');
