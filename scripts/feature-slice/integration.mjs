// Integrated epic head verification for #365.
//
// "Ready for the epic -> main PR" is a claim about one exact commit: the tip of
// the epic branch after every slice merged. This refuses the claim unless
// #363's `verifyPrGate` verifies that SHA and an independent review is recorded
// for the same SHA (LESSONS.md: validate the final integrated head, not each
// branch in a stack). It never merges. A human opens and merges the PR.

import {
  assertTargetBase,
  isGitSha,
  isNonEmptyString,
} from '../bug-publisher/index.mjs';
import {
  decideReviewVerdict,
  verifyPrGate,
  GITHUB_ACTIONS_APP_ID,
} from '../verify-pr-gate.mjs';

// The epic branch must carry both so slice PRs close their issues and CI runs.
export const REQUIRED_EPIC_FILES = Object.freeze([
  '.github/workflows/ci.yml',
  '.github/workflows/epic-close-issues.yml',
]);

export const DEFAULT_MAX_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const BROWSER_E2E = 'Browser E2E';

function reason(code, message) {
  return { code, message };
}

function clock(now) {
  const value = typeof now === 'function' ? now() : now;
  return value ? new Date(value) : new Date();
}

async function read(label, reader, reasons, ...args) {
  if (typeof reader !== 'function') {
    reasons.push(
      reason(`${label}-reader-missing`, `No ${label} reader was provided.`),
    );
    return null;
  }
  try {
    return (await reader(...args)) ?? null;
  } catch (error) {
    reasons.push(
      reason(
        `${label}-read-failed`,
        `Reading ${label} failed (${String(error?.message ?? error)}); the state is unknown, not empty.`,
      ),
    );
    return null;
  }
}

function browserE2eReason(checks, head) {
  const runs = (Array.isArray(checks) ? checks : []).filter(
    (check) =>
      check?.name === BROWSER_E2E && check?.app?.id === GITHUB_ACTIONS_APP_ID,
  );
  if (runs.length === 0) {
    return reason(
      'browser-e2e-missing',
      `"${BROWSER_E2E}" has no run. Dispatch CI with run_e2e=true on the integrated head.`,
    );
  }
  if (runs.some((check) => !Number.isSafeInteger(check.id))) {
    return reason(
      'browser-e2e-unordered',
      `"${BROWSER_E2E}" runs need check-run ids so the newest can be identified.`,
    );
  }
  const latest = runs.reduce((a, b) => (b.id > a.id ? b : a));
  const sha = latest.head_sha ?? latest.headSha;
  if (sha !== head) {
    return reason(
      'browser-e2e-stale-head',
      `"${BROWSER_E2E}" ran on ${sha ?? 'an unknown head'}, not ${head}.`,
    );
  }
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    return reason(
      'browser-e2e-not-success',
      `"${BROWSER_E2E}" is ${latest.status}/${latest.conclusion ?? 'unknown'}, expected completed/success.`,
    );
  }
  return null;
}

function reviewReasons(
  review,
  { head, ciVerified, publisherLogins, now, maxAgeMs },
) {
  if (!review || typeof review !== 'object') {
    return [
      reason(
        'review-missing',
        `No independent review is recorded for ${head}.`,
      ),
    ];
  }
  const reasons = [];
  if (review.headSha !== head) {
    reasons.push(
      reason(
        'review-stale-head',
        `The recorded review is for ${review.headSha ?? 'an unknown head'}, not the integrated head ${head}.`,
      ),
    );
  }
  if (!isNonEmptyString(review.reviewer)) {
    reasons.push(
      reason(
        'review-reviewer-missing',
        'The review does not name its reviewer.',
      ),
    );
  } else if (
    publisherLogins.some(
      (login) => login.toLowerCase() === review.reviewer.toLowerCase(),
    )
  ) {
    reasons.push(
      reason(
        'review-not-independent',
        `Reviewer ${review.reviewer} authored or published this work.`,
      ),
    );
  }
  const recordedAt = Date.parse(review.recordedAt);
  if (Number.isNaN(recordedAt)) {
    reasons.push(
      reason('review-time-invalid', 'The review has no valid recordedAt time.'),
    );
  } else if (recordedAt - now.getTime() > CLOCK_SKEW_MS) {
    reasons.push(
      reason('review-from-future', 'The review is dated in the future.'),
    );
  } else if (now.getTime() - recordedAt > maxAgeMs) {
    reasons.push(
      reason(
        'review-not-fresh',
        `The review is older than ${Math.round(maxAgeMs / 3600000)} hours; record a fresh one.`,
      ),
    );
  }
  if (
    !Number.isInteger(review.blockingFindings) ||
    review.blockingFindings < 0
  ) {
    reasons.push(
      reason(
        'review-findings-invalid',
        'The review must record a non-negative integer of blocking findings.',
      ),
    );
  } else if (review.verdict !== 'ready-for-human') {
    reasons.push(
      reason(
        'review-verdict',
        `The review verdict is "${review.verdict}", not ready-for-human.`,
      ),
    );
  } else {
    const cycles =
      Number.isInteger(review.reworkCycles) && review.reworkCycles >= 0
        ? review.reworkCycles
        : 0;
    const decision = decideReviewVerdict({
      ciVerified,
      blockingFindings: review.blockingFindings,
      reworkCycles: cycles,
    });
    if (decision.verdict !== 'ready-for-human') {
      reasons.push(reason('review-decision', decision.reason));
    }
  }
  return reasons;
}

/**
 * Refuse "ready for the epic -> main PR" unless the exact integrated head is
 * verified and independently reviewed. `readEpicHead` is read before and after
 * every other read; a head that moved in between is refused.
 *
 * Seams: `readEpicHead()`, `readGateInputs(head)` returning `{pr, checks,
 * changedPaths}` (a pre-PR check may pass `pr: {headRefOid: head}`),
 * `readReview(head)`, `hasFileAtRef(ref, path)`, and `now`.
 */
export async function checkEpicReadiness(options = {}) {
  const reasons = [];
  const result = (head) => ({
    ready: reasons.length === 0,
    head,
    epicBranch: options.epicBranch,
    reasons,
    autoMerge: false,
    nextStep:
      reasons.length === 0
        ? 'Open the epic -> main PR for human review. A human decides the merge; nothing merges automatically.'
        : 'Do not open the epic -> main PR. Resolve the reasons and re-run on the current head.',
  });

  const base = assertTargetBase(options.epicBranch);
  if (!base.ok) {
    reasons.push(
      reason(
        base.reason,
        `"${options.epicBranch}" is not an approved epic branch.`,
      ),
    );
    return result(null);
  }

  const head = await read('epic-head', options.readEpicHead, reasons);
  if (!isGitSha(head)) {
    if (head !== null)
      reasons.push(
        reason('epic-head-invalid', 'The epic head is not a commit SHA.'),
      );
    return result(null);
  }

  for (const file of REQUIRED_EPIC_FILES) {
    const present = await read(
      'epic-file',
      options.hasFileAtRef,
      reasons,
      head,
      file,
    );
    if (present === false) {
      reasons.push(
        reason(
          'epic-missing-workflow',
          `The epic branch does not include ${file}.`,
        ),
      );
    } else if (present !== true && present !== null) {
      reasons.push(
        reason('epic-file-invalid', `Could not tell whether ${file} exists.`),
      );
    }
  }

  const gate = await read('gate', options.readGateInputs, reasons, head);
  let ciVerified = false;
  if (gate) {
    const verdict = verifyPrGate({
      pr: gate.pr,
      checks: gate.checks,
      changedPaths: gate.changedPaths,
      expectedHead: head,
    });
    ciVerified = verdict.ok && verdict.head === head;
    if (!ciVerified) {
      for (const item of verdict.reasons)
        reasons.push(reason(`gate-${item.code}`, item.message));
      if (verdict.ok)
        reasons.push(
          reason(
            'gate-head-mismatch',
            `CI verified ${verdict.head}, not ${head}.`,
          ),
        );
    }
    if (options.browserE2eRequired === true) {
      const e2e = browserE2eReason(gate.checks, head);
      if (e2e) reasons.push(e2e);
    }
  }

  const review = await read('review', options.readReview, reasons, head);
  if (
    review !== null ||
    !reasons.some((item) => item.code === 'review-read-failed')
  ) {
    reasons.push(
      ...reviewReasons(review, {
        head,
        ciVerified,
        publisherLogins: Array.isArray(options.publisherLogins)
          ? options.publisherLogins
          : [],
        now: clock(options.now),
        maxAgeMs: options.maxReviewAgeMs ?? DEFAULT_MAX_REVIEW_AGE_MS,
      }),
    );
  }

  const after = await read('epic-head', options.readEpicHead, reasons);
  if (after !== null && after !== head) {
    reasons.push(
      reason(
        'epic-head-moved',
        `The epic head moved from ${head} to ${after} during verification.`,
      ),
    );
  }
  return result(head);
}
