/**
 * Revision-bound verification for agent-authored pull requests (#363).
 *
 * Layer 1 of the independent review is disposable, secret-free execution in
 * `ci.yml`. This module is the decision layer on top of its results. It answers
 * one question: does this exact revision have a completed, successful run of
 * every required job, produced by the GitHub Actions app, with no newer push
 * invalidating the evidence?
 *
 * It deliberately does not call GitHub. Callers pass the `gh pr view` metadata,
 * the check runs for the current head, and the changed paths. That keeps the
 * decision pure and testable, and keeps every network read in the workflow where
 * the token already lives.
 *
 * The aggregate `CI Gate` job exits 0 on a draft pull request because GitHub
 * cannot merge a draft. A green `CI Gate` is therefore not sufficient on its own:
 * `verifyPrGate` rejects drafts before it looks at checks.
 *
 * CLI:
 *   node scripts/verify-pr-gate.mjs verify   --pr pr.json --checks checks.json \
 *     --changed changed-paths.txt [--expected-head <sha>] [--all-excluded true]
 *   node scripts/verify-pr-gate.mjs evidence --pr pr.json --checks checks.json \
 *     --changed changed-paths.txt [--expected-head <sha>] [--all-excluded true] \
 *     [--rework-cycles N]
 *   node scripts/verify-pr-gate.mjs decide   --ci-verified yes|no \
 *     [--findings N] [--rework N]
 *
 * `verify` exits 0 only when the gate is verified, 1 when blocked, and 2 on
 * malformed input. `evidence` and `decide` always exit 0 unless input is bad.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Jobs that must finish `success` on the exact head for every non-draft PR. */
export const REQUIRED_JOBS = Object.freeze([
  'Lint, Types & Format',
  'Test',
  'API Lint & Test Typecheck',
  'Video IR Suite',
  'Build',
]);

/** Required only when the PR changes `src-tauri/`. */
export const RUST_JOB = 'Rust Checks';

/** Aggregate check that branch protection should require. */
export const AGGREGATE_CHECK = 'CI Gate';

/** GitHub Actions app id; a same-named check from another app is not evidence. */
export const GITHUB_ACTIONS_APP_ID = 15368;

/** Maximum automated request-changes cycles before a human must decide. */
export const MAX_REWORK_CYCLES = 3;

const VERDICT_PATTERN =
  /Verdict: `(ready-for-human|request-changes|needs-decision)`/g;

function normalizeCheck(check) {
  const state = check.state == null ? null : String(check.state).toLowerCase();
  const status =
    check.status == null ? null : String(check.status).toLowerCase();
  const conclusion =
    check.conclusion == null
      ? state === 'pending'
        ? null
        : state
      : String(check.conclusion).toLowerCase();

  return {
    name: check.name == null ? '' : String(check.name),
    headSha: check.head_sha ?? check.headSha ?? null,
    status:
      status ??
      (state == null || state === 'pending' ? 'pending' : 'completed'),
    conclusion,
    appId: check.app?.id ?? null,
    id: Number.isSafeInteger(check.id) && check.id > 0 ? check.id : null,
    url: check.html_url ?? check.details_url ?? null,
  };
}

function hasDistinctIds(pool) {
  const ids = new Set(pool.map((check) => check.id));
  return !ids.has(null) && ids.size === pool.length;
}

/**
 * Picks the newest check run for each name. A rerun must not be hidden by an
 * older success, and a check from another app must not impersonate Actions. A
 * check without an app identity is never evidence: there is no fallback pool.
 *
 * The REST `id` is assigned at creation and only grows, so it is the only
 * ordering key. A queued rerun has no timestamps yet, so ordering by time would
 * let an older success outrank it. When a name has several runs without
 * distinct ids the newest is unknown, and the name is reported as unordered.
 */
function latestChecks(checks, appId) {
  const byName = new Map();
  for (const raw of checks) {
    const check = normalizeCheck(raw);
    if (!check.name) continue;
    const candidates = byName.get(check.name) ?? [];
    candidates.push(check);
    byName.set(check.name, candidates);
  }

  const latest = new Map();
  const unordered = new Set();
  for (const [name, candidates] of byName) {
    const pool = candidates.filter((check) => check.appId === appId);
    if (pool.length === 0) continue;
    if (pool.length > 1 && !hasDistinctIds(pool)) {
      unordered.add(name);
      continue;
    }

    pool.sort((a, b) => a.id - b.id);
    latest.set(name, pool[pool.length - 1]);
  }
  return { latest, unordered };
}

function unknownOrderReason(job) {
  return {
    code: 'unknown-order',
    job,
    message: `"${job}" has several runs without distinct check-run ids, so the newest run cannot be identified.`,
  };
}

function isTauriPath(filePath) {
  return filePath === 'src-tauri' || filePath.startsWith('src-tauri/');
}

function checkFailureReason(check, head, job) {
  if (!head || check.headSha !== head) {
    return {
      code: 'stale-head',
      job,
      message: `"${job}" ran on ${check.headSha ?? 'an unknown head'}, not the current head ${head ?? 'unknown'}. A green older head is not evidence for this revision.`,
    };
  }
  if (check.status !== 'completed') {
    return {
      code: 'not-completed',
      job,
      message: `"${job}" is ${check.status}, not completed.`,
    };
  }
  if (check.conclusion !== 'success') {
    return {
      code: check.conclusion === 'cancelled' ? 'cancelled' : 'not-success',
      job,
      message: `"${job}" concluded "${check.conclusion ?? 'unknown'}", expected "success".`,
    };
  }
  return null;
}

/**
 * Decides whether a pull request's exact head is verified by CI.
 *
 * @param {object} input
 * @param {object} input.pr `gh pr view --json state,isDraft,headRefOid,baseRefOid,...`
 * @param {object[]} input.checks Check runs for the head (REST shape or `gh pr checks` shape).
 *   Several runs of one name need distinct REST `id`s, or that name is blocked.
 * @param {string[]} [input.changedPaths] Changed paths, used to scope Rust checks.
 * @param {boolean} [input.rustRequired] Explicit Rust requirement; overrides changedPaths.
 * @param {string} [input.expectedHead] Head captured earlier. A mismatch means a pushed follow-up.
 * @param {number} [input.appId] Required check app id. Defaults to GitHub Actions.
 * @param {boolean} [input.requireAggregate] Require the `CI Gate` aggregate. Defaults to true.
 */
export function verifyPrGate(input = {}) {
  const pr = input.pr ?? {};
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const reasons = [];
  const head = pr.headRefOid ?? null;
  const base = pr.baseRefOid ?? null;
  const mergeCommit = pr.mergeCommit?.oid ?? null;

  if (!head) {
    reasons.push({
      code: 'missing-head',
      message: 'PR metadata has no headRefOid, so no revision can be verified.',
    });
  }
  if (pr.state != null && String(pr.state).toUpperCase() !== 'OPEN') {
    reasons.push({
      code: 'not-open',
      message: `PR state is "${pr.state}", not OPEN.`,
    });
  }
  if (pr.isDraft === true) {
    reasons.push({
      code: 'draft',
      message:
        'Pull request is a draft. `CI Gate` exits 0 without running the required jobs on a draft, so a green gate is not evidence.',
    });
  }
  if (input.expectedHead && head && input.expectedHead !== head) {
    reasons.push({
      code: 'head-moved',
      message: `Expected head ${input.expectedHead}, current head is ${head}. A pushed follow-up invalidates the earlier evidence.`,
    });
  }

  let rustRequired;
  if (typeof input.rustRequired === 'boolean') {
    rustRequired = input.rustRequired;
  } else if (Array.isArray(input.changedPaths)) {
    rustRequired = input.changedPaths.some(isTauriPath);
  } else {
    rustRequired = null;
    reasons.push({
      code: 'rust-requirement-unknown',
      message:
        'Pass rustRequired or changedPaths so the Rust check requirement is explicit.',
    });
  }

  const requiredJobs = [...REQUIRED_JOBS, ...(rustRequired ? [RUST_JOB] : [])];
  const { latest, unordered } = latestChecks(
    checks,
    input.appId ?? GITHUB_ACTIONS_APP_ID,
  );
  const evaluated = [];

  for (const job of requiredJobs) {
    const check = latest.get(job);
    if (unordered.has(job)) {
      reasons.push(unknownOrderReason(job));
      continue;
    }
    if (!check) {
      reasons.push({
        code: 'missing-check',
        job,
        message: `Required job "${job}" has no check run on this head.`,
      });
      continue;
    }
    evaluated.push({
      name: job,
      conclusion: check.conclusion,
      headSha: check.headSha,
      url: check.url,
    });
    const failure = checkFailureReason(check, head, job);
    if (failure) reasons.push(failure);
  }

  // Rust is not required when src-tauri/ did not change, but a present Rust
  // check that failed is still a real failure, not something to ignore.
  if (rustRequired === false) {
    const rust = latest.get(RUST_JOB);
    if (unordered.has(RUST_JOB)) {
      reasons.push(unknownOrderReason(RUST_JOB));
    } else if (rust) {
      evaluated.push({
        name: RUST_JOB,
        conclusion: rust.conclusion,
        headSha: rust.headSha,
        url: rust.url,
      });
      if (
        head &&
        rust.headSha === head &&
        rust.status === 'completed' &&
        !['success', 'skipped', 'neutral'].includes(rust.conclusion)
      ) {
        reasons.push({
          code: 'rust-unexpected-failure',
          job: RUST_JOB,
          message: `"${RUST_JOB}" was not required (src-tauri/ unchanged) but concluded "${rust.conclusion}".`,
        });
      }
    }
  }

  if (input.requireAggregate !== false) {
    const gate = latest.get(AGGREGATE_CHECK);
    if (unordered.has(AGGREGATE_CHECK)) {
      reasons.push(unknownOrderReason(AGGREGATE_CHECK));
    } else if (!gate) {
      reasons.push({
        code: 'missing-check',
        job: AGGREGATE_CHECK,
        message: `Aggregate check "${AGGREGATE_CHECK}" is missing.`,
      });
    } else {
      evaluated.push({
        name: AGGREGATE_CHECK,
        conclusion: gate.conclusion,
        headSha: gate.headSha,
        url: gate.url,
      });
      const failure = checkFailureReason(gate, head, AGGREGATE_CHECK);
      if (failure) reasons.push(failure);
    }
  }

  return {
    ok: reasons.length === 0,
    verdict: reasons.length === 0 ? 'verified' : 'blocked',
    head,
    base,
    mergeCommit,
    rustRequired,
    requiredJobs: [
      ...requiredJobs,
      ...(input.requireAggregate === false ? [] : [AGGREGATE_CHECK]),
    ],
    reasons,
    checks: evaluated,
  };
}

/**
 * Bounded-rework contract. CI that is not verified on the exact head can never
 * produce `ready-for-human`; after the configured number of automated cycles a
 * human must decide instead of the loop asking for another pass.
 */
export function decideReviewVerdict({
  ciVerified = false,
  blockingFindings = 0,
  reworkCycles = 0,
  maxRework = MAX_REWORK_CYCLES,
} = {}) {
  if (!Number.isInteger(reworkCycles) || reworkCycles < 0) {
    throw new TypeError('reworkCycles must be a non-negative integer');
  }
  if (!Number.isInteger(blockingFindings) || blockingFindings < 0) {
    throw new TypeError('blockingFindings must be a non-negative integer');
  }
  if (!Number.isInteger(maxRework) || maxRework < 1) {
    throw new TypeError('maxRework must be a positive integer');
  }

  if (reworkCycles >= maxRework) {
    return {
      verdict: 'needs-decision',
      halt: true,
      reason: `Automated rework reached ${reworkCycles} of ${maxRework} cycles. A human must decide; do not request another automated pass.`,
    };
  }
  if (!ciVerified) {
    return {
      verdict: 'request-changes',
      halt: false,
      reason:
        'CI is not verified on the exact current head. Re-run CI on that head before any approval.',
    };
  }
  if (blockingFindings > 0) {
    return {
      verdict: 'request-changes',
      halt: false,
      reason: `${blockingFindings} blocking finding(s) remain.`,
    };
  }
  return {
    verdict: 'ready-for-human',
    halt: false,
    reason:
      'Static review found no blocking findings. A human merge decision is still required; this is not an approval.',
  };
}

function oneLine(value) {
  return String(value ?? 'unknown')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Renders the evidence block the review must copy verbatim. Every value comes
 * from the verifier, not from the model, so a new push cannot leave an old
 * review looking current.
 */
export function formatReviewEvidence(result, options = {}) {
  const {
    allExcluded = false,
    changedPaths = [],
    reworkCycles = 0,
    reworkLimitReached = false,
  } = options;

  const gate = result.checks.find((check) => check.name === AGGREGATE_CHECK);
  const rust = result.checks.find((check) => check.name === RUST_JOB);

  const lines = [
    '## Revision Evidence',
    '',
    `- Head: \`${oneLine(result.head)}\``,
    `- Base: \`${oneLine(result.base)}\``,
    `- Merge commit: \`${oneLine(result.mergeCommit ?? 'not available')}\``,
    `- CI Gate: \`${oneLine(gate?.conclusion ?? 'missing')}\`${gate?.url ? ` (${gate.url})` : ''}`,
    `- CI verified on exact head: \`${result.ok ? 'yes' : 'no'}\``,
    `- Rust Checks: ${
      result.rustRequired
        ? `\`${oneLine(rust?.conclusion ?? 'missing')}\``
        : '`not required (src-tauri/ unchanged)`'
    }`,
    '- Focused checks:',
  ];

  for (const check of result.checks) {
    lines.push(
      `  - \`${check.name}\`: \`${oneLine(check.conclusion ?? 'missing')}\``,
    );
  }

  if (allExcluded) {
    lines.push(
      '',
      '## No reviewable code changes',
      '',
      `All ${changedPaths.length} changed path(s) matched \`REVIEW_EXCLUDE_PATHS\`, so the scoped diff was empty. These paths were not statically reviewed and need a human:`,
      '',
    );
    for (const filePath of changedPaths) lines.push(`- \`${filePath}\``);
  }

  lines.push('', '### Unverified gaps', '');
  if (result.reasons.length === 0 && !allExcluded) {
    lines.push('- None observed for the required checks.');
  }
  for (const reason of result.reasons) {
    lines.push(`- ${reason.message}`);
  }
  if (allExcluded) {
    lines.push(
      '- The scoped diff was empty, so docs, markdown, and lockfile changes were not reviewed by the model.',
    );
  }
  lines.push(
    `- Automated rework cycles recorded before this run: ${reworkCycles}.`,
  );
  if (reworkLimitReached) {
    lines.push(
      '- Automated rework limit reached: the verdict must be `needs-decision`.',
    );
  }
  lines.push(
    '- A human (`bravew`) must make the merge decision. This is not an approval.',
  );

  return `${lines.join('\n')}\n`;
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function required(flags, key) {
  if (flags[key] === undefined) throw new Error(`--${key} is required`);
  return flags[key];
}

function readJson(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  return parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
}

function readChecks(filePath) {
  const parsed = readJson(filePath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.check_runs)) return parsed.check_runs;
  throw new Error(`${filePath} is not a check-run list`);
}

function readChangedPaths(filePath) {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function cliInput(flags) {
  const input = {
    pr: readJson(required(flags, 'pr')),
    checks: readChecks(required(flags, 'checks')),
  };
  if (flags.changed) input.changedPaths = readChangedPaths(flags.changed);
  if (flags['expected-head']) input.expectedHead = flags['expected-head'];
  if (flags['rust-required']) {
    input.rustRequired = flags['rust-required'] === 'true';
  }
  if (flags['require-aggregate']) {
    input.requireAggregate = flags['require-aggregate'] !== 'false';
  }
  return input;
}

function runVerify(flags) {
  const result = verifyPrGate(cliInput(flags));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

function runEvidence(flags) {
  const input = cliInput(flags);
  const result = verifyPrGate(input);
  const reworkCycles = Number.parseInt(flags['rework-cycles'] ?? '0', 10);
  const allExcluded = flags['all-excluded'] === 'true';
  process.stdout.write(
    formatReviewEvidence(result, {
      allExcluded,
      changedPaths: allExcluded ? (input.changedPaths ?? []) : [],
      reworkCycles: Number.isInteger(reworkCycles) ? reworkCycles : 0,
      reworkLimitReached: reworkCycles >= MAX_REWORK_CYCLES,
    }),
  );
  return 0;
}

function runDecide(flags) {
  const ciVerified = required(flags, 'ci-verified') === 'yes';
  const blockingFindings = Number.parseInt(flags.findings ?? '0', 10);
  const reworkCycles = Number.parseInt(flags.rework ?? '0', 10);
  const decision = decideReviewVerdict({
    ciVerified,
    blockingFindings: Number.isInteger(blockingFindings) ? blockingFindings : 0,
    reworkCycles: Number.isInteger(reworkCycles) ? reworkCycles : 0,
  });
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  return 0;
}

const COMMANDS = {
  verify: runVerify,
  evidence: runEvidence,
  decide: runDecide,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(
      `usage: verify-pr-gate.mjs <${Object.keys(COMMANDS).join('|')}> [flags]`,
    );
    process.exit(2);
  }
  try {
    process.exit(handler(parseFlags(rest)));
  } catch (error) {
    console.error(`::error::${command} failed: ${error.message}`);
    process.exit(2);
  }
}
