// Restricted publisher contract for #362.
//
// The publisher runs in a separate trusted step from the worker. It re-verifies
// the claim and the issue immediately before every push (TOCTOU), refuses a
// non-fast-forward or a branch with human commits, enforces the path policy,
// and opens or updates exactly one PR for the issue.
//
// `verifyClaim` and `resolveApproval` are dependency-injected from #361's
// contract so this module and its tests do not import unpublished code.

import {
  assertOwnedBranch,
  assertPublisherIdentity,
  assertTargetBase,
  evaluatePatchPolicy,
} from './policy.mjs';
import {
  buildPullRequestBody,
  findClosingIssues,
  isGitSha,
  isNonEmptyString,
  validateVerificationReport,
} from './verify.mjs';

export const DEFAULT_PUBLISHER_POLICY = Object.freeze({
  approvedLabel: 'agent:bug-approved',
  holdLabel: 'agent:hold',
  needsDecisionLabel: 'needs-decision',
  securityLabel: 'security',
  bugLabel: 'bug',
  featureLabels: Object.freeze(['enhancement', 'epic']),
});

export const DEFAULT_TARGET_BASE = 'epic/358-cloud-bug-monitor';

function refuse(reason, detail = {}) {
  return { published: false, reason, ...detail };
}

function toTrustedMap(trustedActors) {
  if (trustedActors instanceof Map) return trustedActors;
  const map = new Map();
  for (const actor of trustedActors ?? []) {
    if (actor && typeof actor.login === 'string') {
      map.set(actor.login, actor.association);
    }
  }
  return map;
}

function clock(now) {
  if (typeof now === 'function') return now();
  if (typeof now === 'string') return now;
  return new Date().toISOString();
}

/**
 * Refresh the remote head and the commits ahead of the base. A runner should
 * provide `readBranchState` so the pre-push check is not made against a stale
 * snapshot; without it the caller's values are used.
 */
async function resolveBranchState(options) {
  if (typeof options.readBranchState !== 'function') {
    return {
      remoteHead: options.remoteHead ?? null,
      commitsAhead: options.commitsAhead ?? [],
    };
  }
  const fresh = await options.readBranchState();
  if (!fresh || typeof fresh !== 'object') return null;
  return {
    remoteHead: fresh.remoteHead ?? null,
    commitsAhead: Array.isArray(fresh.commitsAhead) ? fresh.commitsAhead : [],
  };
}

/**
 * Re-read the durable claim and the issue, and require the approval to still be
 * active. Unknown, held, closed, or reclassified issues fail closed.
 */
async function recheck(options, policy) {
  if (typeof options.verifyClaim !== 'function') {
    return { ok: false, reason: 'claim-verifier-missing' };
  }
  if (typeof options.readState !== 'function') {
    return { ok: false, reason: 'state-reader-missing' };
  }
  if (typeof options.readFreshIssue !== 'function') {
    return { ok: false, reason: 'issue-reader-missing' };
  }
  if (typeof options.resolveApproval !== 'function') {
    return { ok: false, reason: 'approval-resolver-missing' };
  }

  const state = await options.readState();
  const verdict = options.verifyClaim(
    state,
    {
      issue: options.issue,
      runId: options.claim.runId,
      epoch: options.claim.epoch,
    },
    clock(options.now),
  );
  if (!verdict || verdict.ok !== true) {
    return {
      ok: false,
      reason: `claim-${verdict?.reason ?? 'unknown'}`,
    };
  }

  const fresh = await options.readFreshIssue();
  if (!fresh || typeof fresh !== 'object') {
    return { ok: false, reason: 'issue-read-failed' };
  }
  if (fresh.isPullRequest === true) {
    return { ok: false, reason: 'not-an-issue' };
  }
  if (fresh.number !== options.issue) {
    return { ok: false, reason: 'issue-mismatch' };
  }
  if (fresh.state !== 'open') {
    return { ok: false, reason: 'issue-closed' };
  }

  const labels = new Set(Array.isArray(fresh.labels) ? fresh.labels : []);
  if (labels.has(policy.holdLabel)) {
    return { ok: false, reason: 'held' };
  }
  if (labels.has(policy.needsDecisionLabel)) {
    return { ok: false, reason: 'needs-decision' };
  }
  if (labels.has(policy.securityLabel)) {
    return { ok: false, reason: 'security-sensitive' };
  }
  if (policy.featureLabels.some((label) => labels.has(label))) {
    return { ok: false, reason: 'reclassified-feature' };
  }
  if (!labels.has(policy.bugLabel)) {
    return { ok: false, reason: 'not-a-bug' };
  }

  const approval = options.resolveApproval(
    fresh,
    toTrustedMap(options.trustedActors),
    options.monitorConfig,
  );
  if (!approval || approval.status !== 'approved') {
    return {
      ok: false,
      reason: `approval-${approval?.status ?? 'unknown'}`,
    };
  }
  return { ok: true, fresh, approval };
}

/**
 * Refuse a push that is not a fast-forward, that carries a commit not authored
 * by the bot, or that cannot prove the local head is the tip of the complete,
 * linear commit range `baseSha..localHead`. Every commit names its single
 * parent so a missing or foreign commit in the range is detectable. The pinned
 * base must be an ancestor of the local head on every push, including the first
 * push of a new branch.
 */
export function assertSafePush({
  baseSha,
  localHead,
  remoteHead = null,
  commitsAhead = [],
  botLogin,
  isAncestor,
}) {
  if (!isGitSha(baseSha)) return { ok: false, reason: 'invalid-base' };
  if (!isGitSha(localHead)) return { ok: false, reason: 'invalid-head' };
  if (remoteHead !== null && !isGitSha(remoteHead)) {
    return { ok: false, reason: 'invalid-remote-head' };
  }
  if (!isNonEmptyString(botLogin)) {
    return { ok: false, reason: 'bot-login-missing' };
  }
  if (localHead === baseSha) {
    return { ok: false, reason: 'no-commits' };
  }
  if (!Array.isArray(commitsAhead) || commitsAhead.length === 0) {
    return { ok: false, reason: 'commit-list-missing' };
  }
  if (commitsAhead[commitsAhead.length - 1]?.sha !== localHead) {
    return { ok: false, reason: 'commit-list-head-mismatch' };
  }
  for (const commit of commitsAhead) {
    if (!commit || !isGitSha(commit.sha)) {
      return { ok: false, reason: 'invalid-commit-sha' };
    }
    if (commit.authorLogin !== botLogin) {
      return {
        ok: false,
        reason: 'human-commit',
        commit: commit.sha,
        author: commit.authorLogin ?? null,
      };
    }
  }
  let expectedParent = baseSha;
  for (const commit of commitsAhead) {
    if (commit.parentSha !== expectedParent) {
      return {
        ok: false,
        reason: 'commit-range-incomplete',
        commit: commit.sha,
      };
    }
    expectedParent = commit.sha;
  }
  if (typeof isAncestor !== 'function') {
    return { ok: false, reason: 'ancestry-check-missing' };
  }
  if (isAncestor(baseSha, localHead) !== true) {
    return { ok: false, reason: 'base-not-ancestor' };
  }
  if (remoteHead !== null && remoteHead !== localHead) {
    if (isAncestor(remoteHead, localHead) !== true) {
      return { ok: false, reason: 'non-fast-forward' };
    }
  }
  return {
    ok: true,
    needsPush: remoteHead !== localHead,
    commitsAhead,
  };
}

async function listOwnedOpenPullRequests(list, branch, issue, base) {
  const pullRequests = await list({ head: branch, issue, base });
  return Array.isArray(pullRequests) ? pullRequests : [];
}

/**
 * Publish a worker result. Returns `{published:false, reason}` for every
 * refusal; it never throws for a policy or verification failure.
 */
export async function publishBugFix(options) {
  const issue = Number(options.issue);
  const policy = { ...DEFAULT_PUBLISHER_POLICY, ...options.policy };
  const claim = {
    issue,
    runId: options.claim?.runId,
    epoch: options.claim?.epoch,
  };

  if (!Number.isInteger(issue) || issue <= 0) {
    return refuse('invalid-issue');
  }
  if (!isNonEmptyString(claim.runId) || !Number.isInteger(claim.epoch)) {
    return refuse('invalid-claim');
  }

  const branchCheck = assertOwnedBranch(options.branch, issue);
  if (!branchCheck.ok) return refuse(branchCheck.reason);

  const identityCheck = assertPublisherIdentity(
    options.identity,
    options.branch,
  );
  if (!identityCheck.ok) {
    return refuse('publisher-identity-invalid', {
      violations: identityCheck.violations,
    });
  }

  const targetBase = options.targetBase ?? DEFAULT_TARGET_BASE;
  const baseCheck = assertTargetBase(targetBase);
  if (!baseCheck.ok) return refuse(baseCheck.reason);

  if (!isGitSha(options.baseSha)) return refuse('invalid-base-sha');
  if (!isGitSha(options.localHead)) return refuse('invalid-head-sha');
  if (options.report?.aborted === true || options.report?.reproduced !== true) {
    return refuse('not-reproduced', { report: options.report });
  }
  if (options.report?.headSha !== options.localHead) {
    return refuse('report-head-mismatch');
  }
  if (options.report?.baseSha !== options.baseSha) {
    return refuse('report-base-mismatch');
  }

  // The file list must come from the caller's own `baseSha..localHead` diff. The
  // worker's report is untrusted input, so it is compared against this list and
  // never substituted for it.
  if (
    !Array.isArray(options.changedFiles) ||
    options.changedFiles.length === 0
  ) {
    return refuse('changed-files-missing');
  }

  const policyResult = evaluatePatchPolicy({
    changedFiles: options.changedFiles,
    authorizedPaths: options.authorizedPaths ?? [],
    componentSizeBase: options.componentSizeBase,
    componentSizeHead: options.componentSizeHead,
    warningBaselineBase: options.warningBaselineBase,
    warningBaselineHead: options.warningBaselineHead,
  });
  if (!policyResult.ok) {
    return refuse('policy-violation', { violations: policyResult.violations });
  }

  const reportCheck = validateVerificationReport(options.report, {
    issue,
    claim,
    branch: options.branch,
    baseSha: options.baseSha,
    headSha: options.localHead,
    changedFiles: policyResult.changedFiles,
  });
  if (!reportCheck.ok) {
    return refuse('report-invalid', { violations: reportCheck.violations });
  }

  const preflight = await recheck({ ...options, issue, claim }, policy);
  if (!preflight.ok) return refuse(preflight.reason);

  const initialBranch = await resolveBranchState(options);
  if (!initialBranch) return refuse('branch-state-unreadable');
  const pushCheck = assertSafePush({
    baseSha: options.baseSha,
    localHead: options.localHead,
    remoteHead: initialBranch.remoteHead,
    commitsAhead: initialBranch.commitsAhead,
    botLogin: options.botLogin,
    isAncestor: options.isAncestor,
  });
  if (!pushCheck.ok) return refuse(pushCheck.reason);

  if (
    !options.github ||
    typeof options.github.listOpenPullRequests !== 'function'
  ) {
    return refuse('github-list-missing');
  }
  if (
    typeof options.github.createPullRequest !== 'function' ||
    typeof options.github.updatePullRequest !== 'function'
  ) {
    return refuse('github-write-missing');
  }

  const title = options.report.prTemplate.title;
  const body = buildPullRequestBody(options.report);
  const closing = findClosingIssues(body);
  if (closing.length !== 1 || closing[0] !== issue) {
    return refuse('pr-closes-wrong-issue', { closing });
  }

  const list = () =>
    listOwnedOpenPullRequests(
      options.github.listOpenPullRequests.bind(options.github),
      options.branch,
      issue,
      targetBase,
    );
  const inspect = (open) => ({
    ours: open.filter(
      (pullRequest) =>
        pullRequest?.headRefName === options.branch &&
        pullRequest?.state === 'open',
    ),
    others: open.filter(
      (pullRequest) =>
        pullRequest?.state === 'open' &&
        pullRequest?.headRefName !== options.branch &&
        findClosingIssues(pullRequest?.body ?? '').includes(issue),
    ),
  });
  const refuseDuplicate = (state) => {
    if (state.ours.length > 1) {
      return refuse('multiple-owned-prs', {
        numbers: state.ours.map((pullRequest) => pullRequest.number),
      });
    }
    if (state.others.length > 0) {
      return refuse('duplicate-pr-exists', {
        numbers: state.others.map((pullRequest) => pullRequest.number),
      });
    }
    return null;
  };

  // Refuse a duplicate PR before pushing an orphan branch.
  const beforePush = inspect(await list());
  const beforePushRefusal = refuseDuplicate(beforePush);
  if (beforePushRefusal) return beforePushRefusal;

  let pushed = false;
  if (pushCheck.needsPush) {
    // TOCTOU: re-read both the durable claim and the issue immediately before
    // the push, and re-check the branch state.
    const prePush = await recheck({ ...options, issue, claim }, policy);
    if (!prePush.ok) return refuse(prePush.reason);

    const prePushState = await resolveBranchState(options);
    if (!prePushState) return refuse('branch-state-unreadable');
    const pushCheckAgain = assertSafePush({
      baseSha: options.baseSha,
      localHead: options.localHead,
      remoteHead: prePushState.remoteHead,
      commitsAhead: prePushState.commitsAhead,
      botLogin: options.botLogin,
      isAncestor: options.isAncestor,
    });
    if (!pushCheckAgain.ok) return refuse(pushCheckAgain.reason);

    if (!options.git || typeof options.git.push !== 'function') {
      return refuse('git-push-missing');
    }
    try {
      await options.git.push({
        branch: options.branch,
        head: options.localHead,
        identity: options.identity,
      });
    } catch (error) {
      return refuse('push-failed', {
        error: String(error?.message ?? error),
      });
    }
    pushed = true;

    // If the runner can re-read the branch, confirm the push landed exactly on
    // the reviewed head and no human commit appeared while we pushed.
    if (typeof options.readBranchState === 'function') {
      const afterPushState = await resolveBranchState(options);
      if (!afterPushState) return refuse('branch-state-unreadable', { pushed });
      if (afterPushState.remoteHead !== options.localHead) {
        return refuse('branch-changed-after-push', {
          pushed,
          remoteHead: afterPushState.remoteHead,
        });
      }
      const afterPushCheck = assertSafePush({
        baseSha: options.baseSha,
        localHead: options.localHead,
        remoteHead: afterPushState.remoteHead,
        commitsAhead: afterPushState.commitsAhead,
        botLogin: options.botLogin,
        isAncestor: options.isAncestor,
      });
      if (!afterPushCheck.ok) return refuse(afterPushCheck.reason, { pushed });
    }
  }

  // A restart after a push creates no new commit, but the PR is still a
  // mutation. Re-check the claim and approval immediately before it too.
  const prePr = await recheck({ ...options, issue, claim }, policy);
  if (!prePr.ok) return refuse(prePr.reason, { pushed });

  // Re-read after the push: another actor may have created a PR meanwhile.
  const current = inspect(await list());
  const currentRefusal = refuseDuplicate(current);
  if (currentRefusal) return { ...currentRefusal, pushed };

  let action;
  if (current.ours.length === 1) {
    try {
      await options.github.updatePullRequest({
        number: current.ours[0].number,
        title,
        body,
        base: targetBase,
      });
    } catch (error) {
      return refuse('pr-update-failed', {
        pushed,
        error: String(error?.message ?? error),
      });
    }
    action = 'updated';
  } else {
    try {
      await options.github.createPullRequest({
        head: options.branch,
        base: targetBase,
        title,
        body,
      });
      action = 'created';
    } catch (error) {
      // The request may have succeeded and the response been lost. Re-read
      // before retrying so a restart never creates a second PR.
      const after = await list();
      const recovered = after.filter(
        (pullRequest) =>
          pullRequest?.headRefName === options.branch &&
          pullRequest?.state === 'open',
      );
      if (recovered.length === 1) {
        action = 'recovered';
      } else {
        return refuse('pr-create-failed', {
          pushed,
          error: String(error?.message ?? error),
        });
      }
    }
  }

  const finalOpen = await list();
  const finalOurs = finalOpen.filter(
    (pullRequest) =>
      pullRequest?.headRefName === options.branch &&
      pullRequest?.state === 'open',
  );
  if (finalOurs.length !== 1) {
    return refuse('pr-count-mismatch', {
      pushed,
      count: finalOurs.length,
    });
  }

  return {
    published: true,
    action,
    pushed,
    branch: options.branch,
    baseSha: options.baseSha,
    headSha: options.localHead,
    targetBase,
    prNumber: finalOurs[0].number,
    prUrl: finalOurs[0].url ?? null,
  };
}
