// Feature-slice worker start and publisher for #365.
//
// This composes #362's primitives (branch ownership, publisher identity, target
// base, patch policy, safe-push proof, worker sandbox) with #364's revision-bound
// approval. It does not call `publishBugFix`: that entry point is the bug lane
// and requires a `bug` label and a reproduced, regression-tested defect.
//
// Every external effect is injected: GitHub reads, git, the clock. Nothing here
// touches the network or the filesystem.
//
// Outcomes a caller can act on:
//   return-to-planning   the brief changed, approval was withdrawn or never
//                        covered this revision; go back to #364 planning.
//   paused               a read failed or the issue is held or closed; the
//                        state is unknown, so nothing is written.
//   paused-out-of-scope  the patch left the slice's declared files.
//   refused              the request itself is malformed or unsafe.

import {
  assertOwnedBranch,
  assertPublisherIdentity,
  assertSafePush,
  assertTargetBase,
  buildPullRequestBody,
  isGitSha,
  isNonEmptyString,
  normalizeRepoPath,
  prepareUnprivilegedWorker,
  requiredChecksForFiles,
} from '../bug-publisher/index.mjs';
import {
  claimFromEvaluation,
  DECISION_LABEL,
  evaluateFeatureClaim,
  HOLD_LABELS,
  revalidateClaim,
} from '../feature-brief/approval.mjs';
import { SURFACES, validateBrief } from '../feature-brief/brief.mjs';
import { evaluateSliceScope } from './scope.mjs';

export const SLICE_REPORT_VERSION = 1;

const SLICE_ID = /^S\d+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const EPIC_NUMBER = /^epic\/(\d+)-/;
const CLOSING_REFERENCE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+((?:[\w.-]+\/[\w.-]+)?#\d+|https?:\/\/github\.com\/\S+)/gi;

function refuse(reason, outcome, detail = {}) {
  return { published: false, outcome, reason, ...detail };
}

export function epicIssueNumber(epicBranch) {
  const match = EPIC_NUMBER.exec(String(epicBranch));
  return match ? Number(match[1]) : null;
}

/**
 * Every closing reference in a PR body, including cross-repository and URL
 * forms that #362's `findClosingIssues` does not see.
 */
export function findClosingReferences(body) {
  if (typeof body !== 'string') return [];
  return [...body.matchAll(CLOSING_REFERENCE)].map((match) => {
    const token = match[1];
    const number =
      /#(\d+)$/.exec(token) ?? /\/(?:issues|pull)\/(\d+)/.exec(token);
    return { token, issue: number ? Number(number[1]) : null };
  });
}

async function safeRead(reader) {
  try {
    return await reader();
  } catch {
    return null;
  }
}

function isHeldOrClosed(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return (
    issue?.state !== 'open' ||
    HOLD_LABELS.some((label) => labels.includes(label))
  );
}

/** Slice issue gate: open, not held, not waiting on a decision. */
async function checkSliceIssue({ sliceIssue, readSliceIssue }) {
  if (typeof readSliceIssue !== 'function') {
    return {
      ok: false,
      outcome: 'refused',
      reason: 'slice-issue-reader-missing',
    };
  }
  const fresh = await safeRead(readSliceIssue);
  if (!fresh || typeof fresh !== 'object') {
    return { ok: false, outcome: 'paused', reason: 'slice-issue-read-failed' };
  }
  if (fresh.isPullRequest === true) {
    return { ok: false, outcome: 'paused', reason: 'not-an-issue' };
  }
  if (fresh.number !== sliceIssue) {
    return { ok: false, outcome: 'paused', reason: 'slice-issue-mismatch' };
  }
  const labels = Array.isArray(fresh.labels) ? fresh.labels : [];
  if (isHeldOrClosed(fresh)) {
    return {
      ok: false,
      outcome: 'paused',
      reason: 'slice-issue-held-or-closed',
    };
  }
  if (labels.includes(DECISION_LABEL)) {
    return {
      ok: false,
      outcome: 'paused',
      reason: 'slice-issue-needs-decision',
    };
  }
  return { ok: true };
}

function sliceFromBrief(briefText, sliceId) {
  const validation = validateBrief(briefText);
  if (!validation.ok) return null;
  const slice = validation.brief.slices.find(
    (candidate) => candidate.id === sliceId,
  );
  if (!slice) return null;
  return { brief: validation.brief, slice };
}

/**
 * Re-read the slice issue, then the brief and approval, and require the approval
 * to still cover the exact digest in `claim`. The approval read is last so it is
 * the freshest read before the write the caller is about to make. The slice scope
 * returned is taken from the brief revision the digest matched.
 */
export async function verifySliceApproval({
  claim,
  sliceIssue,
  readSliceIssue,
  readApprovalInput,
}) {
  if (
    !claim ||
    !DIGEST.test(String(claim.digest)) ||
    !SLICE_ID.test(String(claim.slice)) ||
    !assertTargetBase(claim.epicBranch).ok
  ) {
    return { ok: false, outcome: 'refused', reason: 'invalid-claim' };
  }
  const issueCheck = await checkSliceIssue({ sliceIssue, readSliceIssue });
  if (!issueCheck.ok) return issueCheck;
  if (typeof readApprovalInput !== 'function') {
    return { ok: false, outcome: 'refused', reason: 'approval-reader-missing' };
  }

  const input = await safeRead(readApprovalInput);
  if (!input || typeof input !== 'object') {
    return { ok: false, outcome: 'paused', reason: 'approval-read-failed' };
  }
  const verdict = revalidateClaim(claim, input);
  if (!verdict.valid) {
    const state = evaluateFeatureClaim({ ...input, slice: claim.slice }).state;
    if (state === 'unknown' || isHeldOrClosed(input.issue)) {
      return {
        ok: false,
        outcome: 'paused',
        reason: 'approval-state-unknown',
        reasons: verdict.reasons,
      };
    }
    return {
      ok: false,
      outcome: 'return-to-planning',
      reason: 'brief-or-approval-changed',
      reasons: verdict.reasons,
    };
  }
  const found = sliceFromBrief(input.briefText, claim.slice);
  if (!found) {
    return {
      ok: false,
      outcome: 'return-to-planning',
      reason: 'slice-not-in-brief',
    };
  }
  return {
    ok: true,
    scope: {
      owned: found.slice.owned,
      shared: found.slice.shared,
      depends: found.slice.depends,
    },
    userFacing: found.brief.userFacing === true,
    digest: claim.digest,
    epicBranch: claim.epicBranch,
  };
}

/**
 * Worker start. Re-reads the issue, brief, and approval, and only then builds the
 * unprivileged worker context. A brief edit or withdrawn approval returns
 * `return-to-planning` and no context.
 */
export async function startFeatureSliceWorker(options) {
  const sliceIssue = Number(options?.sliceIssue);
  if (!Number.isInteger(sliceIssue) || sliceIssue <= 0) {
    return { started: false, outcome: 'refused', reason: 'invalid-issue' };
  }
  if (!SLICE_ID.test(String(options.sliceId))) {
    return { started: false, outcome: 'refused', reason: 'invalid-slice' };
  }
  const issueCheck = await checkSliceIssue({
    sliceIssue,
    readSliceIssue: options.readSliceIssue,
  });
  if (!issueCheck.ok) return { started: false, ...issueCheck };
  if (typeof options.readApprovalInput !== 'function') {
    return {
      started: false,
      outcome: 'refused',
      reason: 'approval-reader-missing',
    };
  }

  const input = await safeRead(options.readApprovalInput);
  if (!input || typeof input !== 'object') {
    return {
      started: false,
      outcome: 'paused',
      reason: 'approval-read-failed',
    };
  }
  const evaluation = evaluateFeatureClaim({ ...input, slice: options.sliceId });
  if (!evaluation.eligible) {
    const paused =
      evaluation.state === 'unknown' || isHeldOrClosed(input.issue);
    return {
      started: false,
      outcome: paused ? 'paused' : 'return-to-planning',
      reason: `approval-${evaluation.state}`,
      reasons: evaluation.reasons,
      ...(evaluation.question ? { question: evaluation.question } : {}),
    };
  }

  const claim = claimFromEvaluation(evaluation);
  const base = assertTargetBase(claim.epicBranch);
  if (!base.ok)
    return { started: false, outcome: 'refused', reason: base.reason };
  if (epicIssueNumber(claim.epicBranch) === sliceIssue) {
    return {
      started: false,
      outcome: 'refused',
      reason: 'slice-issue-is-epic',
    };
  }
  const found = sliceFromBrief(input.briefText, claim.slice);
  if (!found)
    return {
      started: false,
      outcome: 'return-to-planning',
      reason: 'slice-not-in-brief',
    };

  const worker = prepareUnprivilegedWorker({
    issue: sliceIssue,
    claim: options.lease,
    branch: options.branch,
    baseSha: options.baseSha,
    sandboxDir: options.sandboxDir,
    baseEnv: options.baseEnv,
    repoAccess: options.repoAccess,
    tmpRoot: options.tmpRoot,
    repoRoot: options.repoRoot,
  });
  if (!worker.ok) {
    return {
      started: false,
      outcome: 'refused',
      reason: 'worker-invalid',
      violations: worker.violations,
    };
  }
  return {
    started: true,
    outcome: 'proceed',
    claim,
    targetBase: claim.epicBranch,
    scope: {
      owned: found.slice.owned,
      shared: found.slice.shared,
      depends: found.slice.depends,
    },
    userFacing: found.brief.userFacing === true,
    context: worker.context,
  };
}

function checkNonEmpty(value, field, violations) {
  if (!isNonEmptyString(value))
    violations.push({ rule: 'report-field', field });
}

/** Validate the worker's slice report against the exact values being published. */
export function validateSliceReport(report, expected) {
  const violations = [];
  if (!report || typeof report !== 'object') {
    return { ok: false, violations: [{ rule: 'report-shape' }] };
  }
  const same = (field, actual, wanted) => {
    if (actual !== wanted) violations.push({ rule: 'report-mismatch', field });
  };
  same('version', report.version, SLICE_REPORT_VERSION);
  same('issue', report.issue, expected.sliceIssue);
  same('sliceId', report.sliceId, expected.sliceId);
  same('digest', report.digest, expected.digest);
  same('branch', report.branch, expected.branch);
  same('baseSha', report.baseSha, expected.baseSha);
  same('headSha', report.headSha, expected.headSha);
  if (report.aborted === true) violations.push({ rule: 'report-aborted' });

  const reported = new Set(
    (Array.isArray(report.changedFiles) ? report.changedFiles : []).map(
      (file) => String(file),
    ),
  );
  const trusted = new Set(expected.changedFiles);
  for (const file of trusted) {
    if (!reported.has(file))
      violations.push({ rule: 'report-changed-files', path: file });
  }
  for (const file of reported) {
    if (!trusted.has(file))
      violations.push({ rule: 'report-changed-files', path: file });
  }

  const checks = new Map();
  for (const check of Array.isArray(report.checks) ? report.checks : []) {
    if (check && isNonEmptyString(check.name)) checks.set(check.name, check);
  }
  for (const name of requiredChecksForFiles([...trusted])) {
    const check = checks.get(name);
    if (!check || check.status !== 'passed' || check.command !== name) {
      violations.push({ rule: 'check-not-passed', name });
    }
  }

  const caller = report.callerEvidence;
  if (!caller || typeof caller !== 'object') {
    violations.push({ rule: 'caller-evidence-missing' });
  } else {
    if (!SURFACES.includes(caller.surface))
      violations.push({ rule: 'caller-surface' });
    if (!normalizeRepoPath(caller.testPath).ok)
      violations.push({ rule: 'caller-test-path' });
    checkNonEmpty(caller.command, 'callerEvidence.command', violations);
    if (caller.passesOnHead !== true)
      violations.push({ rule: 'caller-not-passing' });
    same('callerEvidence.headSha', caller.headSha, expected.headSha);
  }
  checkNonEmpty(report.userVisibleEvidence, 'userVisibleEvidence', violations);
  if (
    expected.userFacing &&
    /^not applicable\.?$/i.test(String(report.userVisibleEvidence).trim())
  ) {
    violations.push({ rule: 'user-visible-evidence-required' });
  }

  const template = report.prTemplate;
  if (!template || typeof template !== 'object') {
    violations.push({ rule: 'report-field', field: 'prTemplate' });
  } else {
    checkNonEmpty(template.title, 'prTemplate.title', violations);
    if (String(template.title ?? '').length > 70)
      violations.push({ rule: 'pr-title-too-long' });
    same('prTemplate.exactHeadSha', template.exactHeadSha, expected.headSha);
    same('prTemplate.closesIssue', template.closesIssue, expected.sliceIssue);
    for (const field of [
      'nodeVersion',
      'pnpmVersion',
      'intent',
      'affectedContracts',
      'verificationSummary',
    ]) {
      checkNonEmpty(template[field], `prTemplate.${field}`, violations);
    }
    for (const field of [
      'accountableContributor',
      'authoringTool',
      'sessionReference',
    ]) {
      checkNonEmpty(
        template.attribution?.[field],
        `prTemplate.attribution.${field}`,
        violations,
      );
    }
    if (!Array.isArray(template.unverified))
      violations.push({ rule: 'report-field', field: 'prTemplate.unverified' });
  }
  return { ok: violations.length === 0, violations };
}

/** PR body: slice and evidence header, then #362's template ending in `Closes #<slice>`. */
export function buildSlicePullRequestBody(
  report,
  { sliceIssue, sliceId, epicBranch, digest },
) {
  const header = [
    '## Slice',
    '',
    `Slice ${sliceId} of \`${epicBranch}\`. Brief digest: \`sha256:${digest}\`.`,
    '',
    '## Caller-boundary and user-visible evidence',
    '',
    `Surface: ${report.callerEvidence.surface}. Test: \`${report.callerEvidence.testPath}\`.`,
    '',
    `Command: \`${report.callerEvidence.command}\``,
    '',
    `User-visible evidence: ${report.userVisibleEvidence}`,
    '',
  ].join('\n');
  const template = {
    ...report.prTemplate,
    corrective: 'not applicable',
    closesIssue: sliceIssue,
  };
  return `${header}\n${buildPullRequestBody({ checks: report.checks, prTemplate: template })}`;
}

function sameRepository(actual, expected) {
  return (
    isNonEmptyString(actual) &&
    isNonEmptyString(expected) &&
    actual.toLowerCase() === expected.toLowerCase()
  );
}

async function resolveBranchState(options) {
  if (typeof options.readBranchState !== 'function') {
    return {
      remoteHead: options.remoteHead ?? null,
      commitsAhead: options.commitsAhead ?? [],
    };
  }
  const fresh = await safeRead(options.readBranchState);
  if (!fresh || typeof fresh !== 'object') return null;
  return {
    remoteHead: fresh.remoteHead ?? null,
    commitsAhead: Array.isArray(fresh.commitsAhead) ? fresh.commitsAhead : [],
  };
}

/**
 * Publish a slice branch and open or update exactly one PR into the approved epic
 * branch. Returns `{published:false, outcome, reason}` for every refusal.
 */
export async function publishFeatureSlice(options) {
  const sliceIssue = Number(options.sliceIssue);
  const claim = options.claim;
  if (!Number.isInteger(sliceIssue) || sliceIssue <= 0) {
    return refuse('invalid-issue', 'refused');
  }
  if (
    !SLICE_ID.test(String(options.sliceId)) ||
    claim?.slice !== options.sliceId
  ) {
    return refuse('invalid-slice', 'refused');
  }
  if (!DIGEST.test(String(claim?.digest)))
    return refuse('invalid-claim', 'refused');

  const branchCheck = assertOwnedBranch(options.branch, sliceIssue);
  if (!branchCheck.ok) return refuse(branchCheck.reason, 'refused');
  const identityCheck = assertPublisherIdentity(
    options.identity,
    options.branch,
  );
  if (!identityCheck.ok) {
    return refuse('publisher-identity-invalid', 'refused', {
      violations: identityCheck.violations,
    });
  }

  // The target is the approved epic branch and nothing else. `main`, a release
  // branch, and another worker's branch fail `assertTargetBase`; any other epic
  // branch fails the comparison with the approval.
  const targetBase = options.targetBase ?? claim.epicBranch;
  const baseCheck = assertTargetBase(targetBase);
  if (!baseCheck.ok) return refuse(baseCheck.reason, 'refused');
  if (targetBase !== claim.epicBranch) {
    return refuse('target-base-not-approved-epic', 'refused');
  }
  const epicIssue = epicIssueNumber(claim.epicBranch);
  if (epicIssue === sliceIssue) return refuse('slice-issue-is-epic', 'refused');

  if (!isGitSha(options.baseSha)) return refuse('invalid-base-sha', 'refused');
  if (!isGitSha(options.localHead))
    return refuse('invalid-head-sha', 'refused');
  if (!isNonEmptyString(options.repository))
    return refuse('repository-missing', 'refused');
  if (
    !Array.isArray(options.changedFiles) ||
    options.changedFiles.length === 0
  ) {
    return refuse('changed-files-missing', 'refused');
  }

  // Scope, then the approval, are re-read at every write. `recheck` returns a
  // refusal or the fresh scope result.
  const recheck = async () => {
    const approval = await verifySliceApproval({
      claim,
      sliceIssue,
      readSliceIssue: options.readSliceIssue,
      readApprovalInput: options.readApprovalInput,
    });
    if (!approval.ok) {
      return {
        refusal: refuse(approval.reason, approval.outcome, {
          ...(approval.reasons ? { reasons: approval.reasons } : {}),
        }),
      };
    }
    const scope = evaluateSliceScope({
      ...approval.scope,
      changedFiles: options.changedFiles,
      componentSizeBase: options.componentSizeBase,
      componentSizeHead: options.componentSizeHead,
      warningBaselineBase: options.warningBaselineBase,
      warningBaselineHead: options.warningBaselineHead,
    });
    if (!scope.ok) {
      return {
        refusal: refuse('scope-violation', 'paused-out-of-scope', {
          violations: scope.violations,
        }),
      };
    }
    return { approval, scope };
  };

  const preflight = await recheck();
  if (preflight.refusal) return preflight.refusal;

  const reportCheck = validateSliceReport(options.report, {
    sliceIssue,
    sliceId: options.sliceId,
    digest: claim.digest,
    branch: options.branch,
    baseSha: options.baseSha,
    headSha: options.localHead,
    changedFiles: preflight.scope.changedFiles,
    userFacing: preflight.approval.userFacing,
  });
  if (!reportCheck.ok) {
    return refuse('report-invalid', 'refused', {
      violations: reportCheck.violations,
    });
  }

  const title = options.report.prTemplate.title;
  const body = buildSlicePullRequestBody(options.report, {
    sliceIssue,
    sliceId: options.sliceId,
    epicBranch: claim.epicBranch,
    digest: claim.digest,
  });
  const closing = findClosingReferences(body);
  if (closing.some((ref) => ref.issue === epicIssue)) {
    return refuse('pr-closes-epic', 'refused', { closing });
  }
  if (closing.length !== 1 || closing[0].token !== `#${sliceIssue}`) {
    return refuse('pr-closes-wrong-issue', 'refused', { closing });
  }

  const github = options.github;
  if (!github || typeof github.listOpenPullRequests !== 'function') {
    return refuse('github-list-missing', 'refused');
  }
  if (
    typeof github.createPullRequest !== 'function' ||
    typeof github.updatePullRequest !== 'function'
  ) {
    return refuse('github-write-missing', 'refused');
  }

  const safePush = (state) =>
    assertSafePush({
      baseSha: options.baseSha,
      localHead: options.localHead,
      remoteHead: state.remoteHead,
      commitsAhead: state.commitsAhead,
      botLogin: options.botLogin,
      isAncestor: options.isAncestor,
    });
  const initialBranch = await resolveBranchState(options);
  if (!initialBranch) return refuse('branch-state-unreadable', 'paused');
  const pushCheck = safePush(initialBranch);
  if (!pushCheck.ok) return refuse(pushCheck.reason, 'refused');

  const list = async () => {
    const open = await github.listOpenPullRequests({
      head: options.branch,
      issue: sliceIssue,
      base: targetBase,
    });
    return Array.isArray(open) ? open : [];
  };
  const isOurs = (pullRequest) =>
    pullRequest?.state === 'open' &&
    pullRequest?.headRefName === options.branch &&
    sameRepository(pullRequest?.headRepository, options.repository);
  const duplicate = (open) => {
    const ours = open.filter(isOurs);
    if (ours.length > 1)
      return refuse('multiple-owned-prs', 'refused', {
        numbers: ours.map((pr) => pr.number),
      });
    const others = open.filter(
      (pr) =>
        pr?.state === 'open' &&
        !isOurs(pr) &&
        findClosingReferences(pr?.body ?? '').some(
          (ref) => ref.issue === sliceIssue,
        ),
    );
    if (others.length > 0)
      return refuse('duplicate-pr-exists', 'refused', {
        numbers: others.map((pr) => pr.number),
      });
    return null;
  };

  const beforePush = await list();
  const beforePushRefusal = duplicate(beforePush);
  if (beforePushRefusal) return beforePushRefusal;

  let pushed = false;
  if (pushCheck.needsPush) {
    // TOCTOU: branch state first, then the brief and approval as the last read
    // before the push. A brief edit or withdrawal lands here as
    // `return-to-planning` and nothing is pushed.
    const prePushState = await resolveBranchState(options);
    if (!prePushState) return refuse('branch-state-unreadable', 'paused');
    const again = safePush(prePushState);
    if (!again.ok) return refuse(again.reason, 'refused');
    if (!options.git || typeof options.git.push !== 'function') {
      return refuse('git-push-missing', 'refused');
    }
    const prePush = await recheck();
    if (prePush.refusal) return prePush.refusal;
    try {
      await options.git.push({
        branch: options.branch,
        head: options.localHead,
        identity: options.identity,
      });
    } catch (error) {
      return refuse('push-failed', 'paused', {
        error: String(error?.message ?? error),
      });
    }
    pushed = true;

    if (typeof options.readBranchState === 'function') {
      const after = await resolveBranchState(options);
      if (!after)
        return refuse('branch-state-unreadable', 'paused', { pushed });
      if (after.remoteHead !== options.localHead) {
        return refuse('branch-changed-after-push', 'paused', {
          pushed,
          remoteHead: after.remoteHead,
        });
      }
      const afterCheck = safePush(after);
      if (!afterCheck.ok)
        return refuse(afterCheck.reason, 'paused', { pushed });
    }
  }

  const current = await list();
  const currentRefusal = duplicate(current);
  if (currentRefusal) return { ...currentRefusal, pushed };

  const ours = current.filter(isOurs);
  let action;
  if (ours.length === 1) {
    const existing = ours[0];
    if (
      existing.title === title &&
      existing.body === body &&
      existing.baseRefName === targetBase
    ) {
      action = 'unchanged';
    } else {
      const prePr = await recheck();
      if (prePr.refusal) return { ...prePr.refusal, pushed };
      try {
        await github.updatePullRequest({
          number: existing.number,
          title,
          body,
          base: targetBase,
        });
      } catch (error) {
        return refuse('pr-update-failed', 'paused', {
          pushed,
          error: String(error?.message ?? error),
        });
      }
      action = 'updated';
    }
  } else {
    const prePr = await recheck();
    if (prePr.refusal) return { ...prePr.refusal, pushed };
    try {
      await github.createPullRequest({
        head: options.branch,
        base: targetBase,
        title,
        body,
      });
      action = 'created';
    } catch (error) {
      const recovered = (await list()).filter(isOurs);
      if (recovered.length === 1) {
        action = 'recovered';
      } else {
        return refuse('pr-create-failed', 'paused', {
          pushed,
          error: String(error?.message ?? error),
        });
      }
    }
  }

  const finalOurs = (await list()).filter(isOurs);
  if (finalOurs.length !== 1) {
    return refuse('pr-count-mismatch', 'paused', {
      pushed,
      count: finalOurs.length,
    });
  }
  return {
    published: true,
    outcome: 'published',
    action,
    pushed,
    branch: options.branch,
    baseSha: options.baseSha,
    headSha: options.localHead,
    targetBase,
    closes: sliceIssue,
    prNumber: finalOurs[0].number,
    prUrl: finalOurs[0].url ?? null,
  };
}
