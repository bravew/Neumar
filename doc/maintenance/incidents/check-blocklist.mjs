// Validates a contributor policy blocklist against the entry contract in
// blocklist-schema.mjs.
//
//   node doc/maintenance/incidents/check-blocklist.mjs <path-to-blocklist.json>
//
// Exits 0 when the document and every entry match the schema, 1 otherwise. An
// empty blocklist is valid: the policy starts with no entries.

import { validateBlocklist } from './blocklist-schema.mjs';

import { readFileSync } from 'node:fs';
import process from 'node:process';

const file = process.argv[2];
if (!file) {
  console.error(
    'Usage: node doc/maintenance/incidents/check-blocklist.mjs <blocklist.json>',
  );
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(readFileSync(file, 'utf-8'));
} catch (error) {
  console.error(`Cannot read ${file}: ${error.message}`);
  process.exit(1);
}

const { ok, errors } = validateBlocklist(doc);
if (!ok) {
  console.error(`${file} is not a valid blocklist:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const count = doc.entries.length;
console.log(
  `ok: ${file} is a valid blocklist with ${count} entr${count === 1 ? 'y' : 'ies'}`,
);
