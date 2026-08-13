#!/usr/bin/env node
/**
 * eval-list — discover registered eval cases.
 *
 * Modes:
 *   --json        emit JSON
 *   --tier <t>    filter to a single tier (gate|periodic)
 *   --case <id>   show only this case
 */
import { flag, listCaseFiles, readCaseMeta } from './eval-utils.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const tierFilter = flag(args, '--tier');
const caseFilter = flag(args, '--case');

let evals = listCaseFiles(ROOT, ['src-api/test/evals']).map((file) =>
  readCaseMeta(ROOT, file),
);

if (tierFilter) evals = evals.filter((e) => e.tier === tierFilter);
if (caseFilter) evals = evals.filter((e) => e.id === caseFilter);

if (evals.length === 0) {
  if (!jsonMode) console.error('No eval cases match the given filters.');
  process.exitCode = 1;
}

if (jsonMode) {
  process.stdout.write(`${JSON.stringify({ evals }, null, 2)}\n`);
} else {
  for (const item of evals)
    console.log(`${item.id}\t${item.tier}\t${item.file}`);
}
