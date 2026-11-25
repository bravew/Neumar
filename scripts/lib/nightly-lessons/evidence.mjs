/**
 * Evidence validator for lesson proposals.
 *
 * LESSONS.md only accepts a rule with evidence: a PR number, a commit, or a
 * file and line, plus what was run, what was missed, and the UTC review date.
 * A proposal that cannot show all of that is rejected, never softened.
 */

import { isUtcDate } from './lessons-file.mjs';

const PR_REF = /^#\d+$/;
const COMMIT_REF = /^[0-9a-f]{7,40}$/;
const FILE_LINE_REF = /^[\w@][\w@./-]*\.\w+:\d+$/;

/** Commits are cited by their first 8 characters, the form LESSONS.md uses. */
export function normalizeRef(ref) {
  const trimmed = String(ref).trim();
  return COMMIT_REF.test(trimmed) ? trimmed.slice(0, 8) : trimmed;
}

export function isEvidenceRef(ref) {
  const normalized = normalizeRef(ref);
  return (
    PR_REF.test(normalized) ||
    COMMIT_REF.test(normalized) ||
    FILE_LINE_REF.test(normalized)
  );
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate one proposal. `kind: 'increment'` targets an existing lesson by key;
 * `kind: 'new'` adds a lesson and also needs `rule` and `section`.
 * Returns `{ ok, problems, proposal }` where `proposal.refs` is normalized.
 */
export function validateProposal(proposal) {
  const problems = [];
  const input = proposal ?? {};

  if (input.kind !== 'increment' && input.kind !== 'new') {
    problems.push('kind must be "increment" or "new"');
  }
  if (input.kind === 'increment' && !nonEmpty(input.lessonKey)) {
    problems.push('increment proposals need a lessonKey');
  }
  if (input.kind === 'new') {
    if (!nonEmpty(input.rule))
      problems.push('new lessons need the rule sentence');
    if (!nonEmpty(input.section)) problems.push('new lessons need a section');
  }
  if (!isUtcDate(input.reviewDate)) {
    problems.push('reviewDate must be a real UTC date (YYYY-MM-DD)');
  }

  const refs = Array.isArray(input.refs) ? input.refs.map(normalizeRef) : [];
  if (refs.length === 0) {
    problems.push(
      'evidence needs at least one PR, commit, or file:line reference',
    );
  }
  for (const ref of refs) {
    if (!isEvidenceRef(ref))
      problems.push(`not a PR, commit, or file:line reference: ${ref}`);
  }
  if (!nonEmpty(input.summary))
    problems.push('summary (why this is a failure pattern) is required');
  if (!nonEmpty(input.ran)) problems.push('ran (what was run) is required');
  if (!nonEmpty(input.missed))
    problems.push('missed (what was missed) is required');

  for (const field of ['summary', 'ran', 'missed', 'rule']) {
    if (typeof input[field] === 'string' && /[\r\n]/.test(input[field])) {
      problems.push(`${field} must be a single line`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    proposal: { ...input, refs },
  };
}
