import {
  claimFromEvaluation,
  evaluateFeatureClaim,
  revalidateClaim,
} from './approval.mjs';
import { canonicalizeBrief, digestBrief, validateBrief } from './brief.mjs';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const brief = readFileSync(
  fileURLToPath(new URL('./fixtures/valid-brief.md', import.meta.url)),
  'utf-8',
);
const digest = digestBrief(brief);

const T0 = '2026-11-24T10:00:00Z';
const T1 = '2026-11-24T11:00:00Z';

function comment(body, overrides = {}) {
  return {
    id: overrides.id ?? 1,
    authorAssociation: 'OWNER',
    authorType: 'User',
    createdAt: T0,
    updatedAt: T0,
    body,
    ...overrides,
  };
}

const approve = (d = digest, slices = 'S1', epic = 'epic/900-saved-filters') =>
  `Approved.\nBrief-Approval: sha256=${d} epic=${epic} slices=${slices}`;

function input(overrides = {}) {
  return {
    readComplete: true,
    issue: { state: 'open', labels: ['enhancement'] },
    briefText: brief,
    comments: [comment(approve())],
    slice: 'S1',
    ...overrides,
  };
}

test('the example brief is valid', () => {
  const result = validateBrief(brief);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(
    result.brief.slices.map((slice) => slice.id),
    ['S1', 'S2'],
  );
});

test('digest ignores line endings and trailing whitespace, not content', () => {
  const crlf = brief
    .replace(/\n/g, '\r\n')
    .replace(/outcome\r\n/i, 'outcome   \r\n');
  assert.equal(canonicalizeBrief(crlf), canonicalizeBrief(brief));
  assert.equal(digestBrief(crlf), digest);
  assert.notEqual(digestBrief(brief.replace('sidebar', 'toolbar')), digest);
});

test('a raw enhancement request is blocked with one blocking question and no claim', () => {
  const raw = '## Problem\nI want filters.\n\n## Proposed solution\nAdd them.';
  const result = evaluateFeatureClaim(input({ briefText: raw, comments: [] }));
  assert.equal(result.eligible, false);
  assert.equal(result.state, 'needs-decision');
  assert.deepEqual(result.labelsToAdd, ['needs-decision']);
  assert.equal(typeof result.question, 'string');
  assert.ok(result.question.endsWith('?'));
  assert.equal(result.question.split('?').length - 1, 1);
});

test('a missing brief asks for one, an underspecified brief names the gap', () => {
  assert.equal(
    evaluateFeatureClaim(input({ briefText: null })).state,
    'needs-decision',
  );
  const noSurface = brief.replace('[ui-flow] ', '');
  const result = validateBrief(noSurface);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'acceptance-surface');
});

test('user-facing text requires all six locales', () => {
  const result = validateBrief(brief.replace(', pt.', '.'));
  assert.equal(result.ok, false);
  assert.match(result.errors.map((e) => e.message).join('\n'), /missing: pt/);
});

test('slice rules: shared files must be scheduled, dependencies must be earlier', () => {
  const sharedOwned = brief.replace(
    'src-api/src/app/api/filters.ts,',
    'package.json, src-api/src/app/api/filters.ts,',
  );
  assert.equal(validateBrief(sharedOwned).errors[0].code, 'slice-shared-owned');
  const forward = brief.replace('Depends on: none', 'Depends on: S2');
  assert.equal(validateBrief(forward).errors[0].code, 'slice-depends');
  const noShared = brief.replace(
    '- Shared files: src-api/src/http-daemon.ts\n',
    '',
  );
  assert.equal(validateBrief(noShared).errors[0].code, 'slice-shared');
});

test('a collaborator approval at the exact digest authorizes only its slices', () => {
  const result = evaluateFeatureClaim(input());
  assert.equal(result.eligible, true);
  assert.deepEqual(result.authorizedSlices, ['S1']);
  const other = evaluateFeatureClaim(input({ slice: 'S2' }));
  assert.equal(other.eligible, false);
  assert.match(other.reasons[0], /not authorized/);
});

test('approval from a non-collaborator, a bot, or an edited comment is rejected', () => {
  for (const override of [
    { authorAssociation: 'NONE' },
    { authorAssociation: 'CONTRIBUTOR' },
    { authorType: 'Bot' },
    { updatedAt: T1 },
  ]) {
    const result = evaluateFeatureClaim(
      input({ comments: [comment(approve(), override)] }),
    );
    assert.equal(result.eligible, false, JSON.stringify(override));
    assert.equal(result.rejected.length, 1);
  }
});

test('an approval example in a code fence or quote is not a decision', () => {
  const fenced = comment(`\`\`\`\n${approve()}\n\`\`\``);
  const quoted = comment(
    approve()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
    { id: 2 },
  );
  const result = evaluateFeatureClaim(input({ comments: [fenced, quoted] }));
  assert.equal(result.eligible, false);
});

test('editing the brief after approval invalidates it', () => {
  const edited = `${brief}\n- Extra scope.\n`;
  const result = evaluateFeatureClaim(input({ briefText: edited }));
  assert.equal(result.eligible, false);
  assert.match(result.reasons[0], /changed after approval/);
});

test('a later withdrawal wins, and a later re-approval wins again', () => {
  const withdraw = comment(`Brief-Approval-Withdrawn: sha256=${digest}`, {
    id: 2,
    createdAt: T1,
    updatedAt: T1,
  });
  assert.equal(
    evaluateFeatureClaim(input({ comments: [comment(approve()), withdraw] }))
      .eligible,
    false,
  );
  const reapprove = comment(approve(), {
    id: 3,
    createdAt: '2026-11-24T12:00:00Z',
    updatedAt: '2026-11-24T12:00:00Z',
  });
  assert.equal(
    evaluateFeatureClaim(
      input({ comments: [comment(approve()), withdraw, reapprove] }),
    ).eligible,
    true,
  );
});

test('the approval must name the brief epic and declared slices', () => {
  assert.equal(
    evaluateFeatureClaim(
      input({ comments: [comment(approve(digest, 'S1', 'epic/1-other'))] }),
    ).eligible,
    false,
  );
  assert.equal(
    evaluateFeatureClaim(
      input({ comments: [comment(approve(digest, 'S1,S9'))] }),
    ).eligible,
    false,
  );
});

test('hold, needs-decision, closed issue, and partial reads never claim', () => {
  for (const override of [
    { issue: { state: 'open', labels: ['agent:hold'] } },
    { issue: { state: 'open', labels: ['needs-decision'] } },
    { issue: { state: 'closed', labels: [] } },
  ]) {
    assert.equal(evaluateFeatureClaim(input(override)).eligible, false);
  }
  const partial = evaluateFeatureClaim(input({ readComplete: false }));
  assert.equal(partial.state, 'unknown');
  assert.equal(partial.eligible, false);
  assert.equal(
    evaluateFeatureClaim(input({ readComplete: undefined })).state,
    'unknown',
  );
});

test('a label is never approval', () => {
  const labelled = input({
    comments: [],
    issue: { state: 'open', labels: ['enhancement', 'agent:bug-approved'] },
  });
  assert.equal(evaluateFeatureClaim(labelled).eligible, false);
});

test('revalidation before worker launch or publisher push catches drift', () => {
  const claim = claimFromEvaluation(evaluateFeatureClaim(input()));
  assert.equal(revalidateClaim(claim, input()).valid, true);

  const withdraw = comment(`Brief-Approval-Withdrawn: sha256=${digest}`, {
    id: 2,
    createdAt: T1,
    updatedAt: T1,
  });
  assert.equal(
    revalidateClaim(claim, input({ comments: [comment(approve()), withdraw] }))
      .valid,
    false,
  );
  assert.equal(
    revalidateClaim(claim, input({ briefText: `${brief}\nmore\n` })).valid,
    false,
  );
  assert.equal(
    revalidateClaim(claim, input({ readComplete: false })).valid,
    false,
  );
  assert.throws(() =>
    claimFromEvaluation(evaluateFeatureClaim(input({ comments: [] }))),
  );
});
