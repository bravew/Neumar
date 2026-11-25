// Command line front end for the feature brief gate. Reads files only.
//
//   node scripts/feature-brief/cli.mjs validate <brief.md>
//   node scripts/feature-brief/cli.mjs digest <brief.md>
//   node scripts/feature-brief/cli.mjs evaluate <input.json>
//
// evaluate takes the JSON shape documented on evaluateFeatureClaim in
// approval.mjs, with "briefPath" in place of "briefText". It exits 0 only when
// the slice is eligible.

import { evaluateFeatureClaim } from './approval.mjs';
import { digestBrief, validateBrief } from './brief.mjs';

import { readFileSync } from 'node:fs';
import process from 'node:process';

const [command, file] = process.argv.slice(2);
const usage =
  'Usage: cli.mjs validate <brief.md> | digest <brief.md> | evaluate <input.json>';

if (!['validate', 'digest', 'evaluate'].includes(command) || !file) {
  console.error(usage);
  process.exit(2);
}

function read(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch (error) {
    console.error(`Cannot read ${path}: ${error.message}`);
    process.exit(2);
  }
}

if (command === 'validate') {
  const { ok, errors } = validateBrief(read(file));
  if (!ok) {
    console.error(`${file} is not a valid Reviewed Feature Brief:`);
    for (const error of errors) console.error(`- ${error.message}`);
    process.exit(1);
  }
  console.log(`${file} is valid.`);
} else if (command === 'digest') {
  console.log(digestBrief(read(file)));
} else {
  let parsed;
  try {
    parsed = JSON.parse(read(file));
  } catch (error) {
    console.error(`Invalid JSON in ${file}: ${error.message}`);
    process.exit(2);
  }
  const { briefPath, ...rest } = parsed;
  const result = evaluateFeatureClaim({
    ...rest,
    briefText: briefPath ? read(briefPath) : null,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.eligible ? 0 : 1);
}
