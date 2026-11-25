// Revision-bound approval gate for feature briefs.
//
// Pure function of plain data. The caller reads the issue, its labels, its
// comments and the brief, then passes them in with readComplete: true. A failed
// or truncated read must pass readComplete: false, which yields state "unknown"
// and never "eligible" (LESSONS.md: a failed read means unknown, never empty).
//
// Approval is a comment line from a repository OWNER, MEMBER or COLLABORATOR:
//
//   Brief-Approval: sha256=<64 hex> epic=epic/<N>-<slug> slices=S1,S2
//   Brief-Approval-Withdrawn: sha256=<64 hex>
//
// The digest is of the canonical brief, so editing the brief invalidates the
// approval. Labels are never approval, because editing an issue does not clear
// them.

import { digestBrief, trackFence, validateBrief } from './brief.mjs';

export const TRUSTED_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);
export const HOLD_LABELS = ['agent:hold'];
export const DECISION_LABEL = 'needs-decision';

const APPROVAL =
  /^Brief-Approval:\s+sha256=([0-9a-f]{64})\s+epic=(\S+)\s+slices=(S\d+(?:,S\d+)*)\s*$/;
const WITHDRAWN = /^Brief-Approval-Withdrawn:\s+sha256=([0-9a-f]{64})\s*$/;

// Marker lines inside fenced code or block quotes are examples or quotations,
// not decisions. Fences follow CommonMark: `~~~` counts, and a shorter or
// differently fenced line does not close an open fence.
function markerLines(body) {
  const lines = [];
  let fence = null;
  for (const line of String(body).split(/\r?\n/)) {
    const tracked = trackFence(line, fence);
    fence = tracked.fence;
    if (!tracked.isFenceLine && !fence) lines.push(line);
  }
  return lines;
}

function untrustedReason(comment, issueAuthor) {
  if (!comment.authorLogin) {
    return 'comment author identity is missing';
  }
  if (comment.authorLogin.toLowerCase() === String(issueAuthor).toLowerCase()) {
    return 'issue authors cannot approve their own request';
  }
  if (!TRUSTED_ASSOCIATIONS.has(comment.authorAssociation)) {
    return `author association ${comment.authorAssociation ?? 'unknown'} is not trusted`;
  }
  if (comment.authorType !== 'User') {
    return `author type ${comment.authorType ?? 'unknown'} is not a human user`;
  }
  if (comment.updatedAt !== comment.createdAt) {
    return 'comment was edited after it was posted';
  }
  return null;
}

// Comment ids are integers. Comparing their strings puts "10" before "9", which
// would let an approval outrank a later withdrawal posted in the same second.
function compareCommentIds(a, b) {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  } catch {
    return String(a).localeCompare(String(b));
  }
}

function decisionsFrom(comments, issueAuthor) {
  const decisions = [];
  const rejected = [];
  for (const comment of comments) {
    for (const line of markerLines(comment.body)) {
      const approval = APPROVAL.exec(line);
      const withdrawn = approval ? null : WITHDRAWN.exec(line);
      if (!approval && !withdrawn) continue;
      const reason = untrustedReason(comment, issueAuthor);
      if (reason) {
        rejected.push({ commentId: comment.id, reason });
        continue;
      }
      decisions.push(
        approval
          ? {
              kind: 'approval',
              commentId: comment.id,
              createdAt: comment.createdAt,
              digest: approval[1],
              epicBranch: approval[2],
              slices: approval[3].split(','),
            }
          : {
              kind: 'withdrawal',
              commentId: comment.id,
              createdAt: comment.createdAt,
              digest: withdrawn[1],
            },
      );
    }
  }
  decisions.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      compareCommentIds(a.commentId, b.commentId),
  );
  return { decisions, rejected };
}

function blocked(state, reason, extra = {}) {
  return { eligible: false, state, reasons: [reason], ...extra };
}

// input: {
//   readComplete: boolean,
//   issue: { state: 'open'|'closed', labels: string[], authorLogin: string },
//   briefText: string | null,
//   comments: [{ id, authorLogin, authorAssociation, authorType, createdAt,
//                updatedAt, body }],
//   slice: 'S1'
// }
// authorLogin on the issue and on each comment is required. Without the issue
// author the gate cannot tell an approval from the requester's self-approval, so
// a missing identity is an incomplete read, not an empty one.
export function evaluateFeatureClaim(input) {
  if (input.readComplete !== true) {
    return blocked(
      'unknown',
      'A GitHub read was partial or failed; treating state as unknown.',
    );
  }
  if (
    typeof input.issue?.authorLogin !== 'string' ||
    !input.issue.authorLogin
  ) {
    return blocked(
      'unknown',
      'The issue author was not read; treating state as unknown.',
    );
  }
  if (input.issue.state !== 'open') {
    return blocked('blocked', 'The issue is not open.');
  }
  const labels = input.issue.labels ?? [];
  if (HOLD_LABELS.some((label) => labels.includes(label))) {
    return blocked('blocked', 'The issue is on hold.');
  }
  if (labels.includes(DECISION_LABEL)) {
    return blocked(
      'blocked',
      `The issue is labelled ${DECISION_LABEL}; a maintainer must clear it.`,
    );
  }

  const validation = validateBrief(input.briefText);
  if (!validation.ok) {
    // One concrete question, never a list and never a guess.
    const [first] = validation.errors;
    return {
      eligible: false,
      state: 'needs-decision',
      reasons: validation.errors.map((error) => error.message),
      question: first.question,
      labelsToAdd: [DECISION_LABEL],
    };
  }

  const { brief } = validation;
  const digest = digestBrief(input.briefText);
  const { decisions, rejected } = decisionsFrom(
    input.comments ?? [],
    input.issue.authorLogin,
  );
  const forThisBrief = decisions.filter(
    (decision) => decision.digest === digest,
  );
  const latest = forThisBrief.at(-1);

  if (!latest || latest.kind === 'withdrawal') {
    const staleApproval = decisions.some(
      (decision) => decision.kind === 'approval',
    );
    const reason = latest
      ? 'Approval for this brief revision was withdrawn.'
      : staleApproval
        ? 'The brief changed after approval; no approval matches the current digest.'
        : 'No trusted maintainer has approved this brief revision.';
    return blocked('blocked', reason, { digest, rejected });
  }

  if (latest.epicBranch !== brief.epicBranch) {
    return blocked(
      'blocked',
      'The approval names a different epic branch than the brief.',
      {
        digest,
        rejected,
      },
    );
  }
  const declared = new Set(brief.slices.map((slice) => slice.id));
  const authorized = latest.slices.filter((id) => declared.has(id));
  if (authorized.length !== latest.slices.length) {
    return blocked(
      'blocked',
      'The approval names a slice that the brief does not declare.',
      {
        digest,
        rejected,
      },
    );
  }
  if (!authorized.includes(input.slice)) {
    return blocked(
      'blocked',
      `Slice ${input.slice} is not authorized by the approval.`,
      {
        digest,
        rejected,
      },
    );
  }

  return {
    eligible: true,
    state: 'eligible',
    reasons: [],
    digest,
    epicBranch: brief.epicBranch,
    slice: input.slice,
    authorizedSlices: authorized,
    approvalCommentId: latest.commentId,
    rejected,
  };
}

export function claimFromEvaluation(evaluation) {
  if (!evaluation.eligible)
    throw new Error('Cannot claim an ineligible brief.');
  return {
    digest: evaluation.digest,
    epicBranch: evaluation.epicBranch,
    slice: evaluation.slice,
  };
}

// Run at worker start and again immediately before the publisher pushes. Both
// re-read current state; a stale claim is never trusted on its own.
export function revalidateClaim(claim, currentInput) {
  const evaluation = evaluateFeatureClaim({
    ...currentInput,
    slice: claim.slice,
  });
  if (!evaluation.eligible)
    return { valid: false, reasons: evaluation.reasons };
  if (
    evaluation.digest !== claim.digest ||
    evaluation.epicBranch !== claim.epicBranch
  ) {
    return {
      valid: false,
      reasons: ['The brief revision changed since the claim.'],
    };
  }
  return { valid: true, reasons: [] };
}
