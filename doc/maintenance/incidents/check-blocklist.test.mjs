import { REQUIRED_FIELDS, validateBlocklist } from './blocklist-schema.mjs';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (name) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf-8'),
  );

test('committed blocklist is valid and empty', () => {
  const { ok, errors } = validateBlocklist(read('./blocklist.json'));
  assert.equal(ok, true, errors.join('; '));
});

test('valid fixture entry passes', () => {
  const { ok, errors } = validateBlocklist(
    read('./fixtures/blocklist-valid.json'),
  );
  assert.equal(ok, true, errors.join('; '));
});

test('fixture missing a required field is rejected', () => {
  const { ok, errors } = validateBlocklist(
    read('./fixtures/blocklist-invalid.json'),
  );
  assert.equal(ok, false);
  assert.match(errors.join('\n'), /missing required field "remediation"/);
});

test('an entry missing any required field is rejected', () => {
  for (const field of REQUIRED_FIELDS) {
    const entry = read('./fixtures/blocklist-valid.json').entries[0];
    delete entry[field];
    const { ok, errors } = validateBlocklist({
      schema: { entry: { required: REQUIRED_FIELDS } },
      entries: [entry],
    });
    assert.equal(ok, false, `expected ${field} to be required`);
    assert.match(
      errors.join('\n'),
      new RegExp(`missing required field "${field}"`),
    );
  }
});

test('a documented schema that drops a required field is rejected', () => {
  const doc = read('./blocklist.json');
  doc.schema.entry.required = doc.schema.entry.required.filter(
    (field) => field !== 'appealLink',
  );
  const { ok, errors } = validateBlocklist(doc);
  assert.equal(ok, false);
  assert.match(errors.join('\n'), /does not match the validator contract/);
});
