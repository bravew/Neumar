// Unprivileged worker contract for #362.
//
// The worker never holds push, PR, release, signing, or R2 credentials. This
// module builds its environment, proves the checkout is read-only and the
// sandbox is a temp directory, and validates the report the publisher will
// consume. It performs no filesystem writes itself.

import { assertOwnedBranch } from './policy.mjs';
import {
  createVerificationReport,
  isGitSha,
  isNonEmptyString,
  validateVerificationReport,
} from './verify.mjs';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The worker environment is an allowlist. A denylist cannot enumerate every
// credential-bearing or behavior-changing variable a runner may carry (for
// example `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` inject git
// configuration without any `GIT_CONFIG_GLOBAL` file), so only these names are
// copied from the caller's environment.
const ALLOWED_RUNTIME_ENV_NAMES = new Set([
  'PATH',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  // Model access the worker is approved to use. It is a model credential, not a
  // publish credential: it cannot push, open a PR, or sign a release.
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
]);

const ALLOWED_RUNTIME_ENV_PREFIXES = ['LC_', 'NEUMAR_MODEL_'];

// Names `scrubWorkerEnvironment` sets itself, every one pointing into the
// sandbox or disabling an interactive/global lookup.
const WORKER_SET_ENV_NAMES = new Set([
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'NEUMAR_APP_DATA_DIR',
  'TMPDIR',
  'GH_CONFIG_DIR',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_TERMINAL_PROMPT',
  'GIT_ASKPASS',
  'npm_config_cache',
]);

function isAllowedRuntimeEnvName(name) {
  return (
    ALLOWED_RUNTIME_ENV_NAMES.has(name) ||
    ALLOWED_RUNTIME_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** True when the worker must not receive or hold this variable. */
export function isDeniedEnvName(name) {
  return !isAllowedRuntimeEnvName(name) && !WORKER_SET_ENV_NAMES.has(name);
}

/**
 * Resolve symlinks for a path that may not exist yet: the nearest existing
 * ancestor is resolved physically and the missing remainder is appended.
 */
function physicalPath(target) {
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync(resolved);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    return path.join(physicalPath(parent), path.basename(resolved));
  }
}

function isWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * The sandbox must be a temp directory, not the host home and not the
 * repository. `tmpRoot` defaults to the OS temp directory; CI may pass its own
 * runner temp root.
 */
export function assertIsolatedSandbox(
  sandboxDir,
  tmpRoot = os.tmpdir(),
  repoRoot,
) {
  if (!isNonEmptyString(sandboxDir) || !path.isAbsolute(sandboxDir)) {
    return { ok: false, reason: 'sandbox-not-absolute' };
  }
  // Compare physical paths: a symlink under the temp root that points at the
  // home directory or the repository must not pass a lexical prefix check.
  let resolved;
  let home;
  let root;
  let repo = null;
  try {
    resolved = physicalPath(sandboxDir);
    home = physicalPath(os.homedir());
    root = physicalPath(tmpRoot);
    if (repoRoot) repo = physicalPath(repoRoot);
  } catch {
    return { ok: false, reason: 'sandbox-unresolvable' };
  }
  if (isWithin(resolved, home)) {
    return { ok: false, reason: 'sandbox-inside-home' };
  }
  if (!isWithin(resolved, root)) {
    return { ok: false, reason: 'sandbox-outside-temp' };
  }
  if (repo !== null && isWithin(resolved, repo)) {
    return { ok: false, reason: 'sandbox-inside-repo' };
  }
  return { ok: true, sandboxDir: resolved };
}

/**
 * Build the worker environment: copy only the allowlisted runtime and model
 * variables, and point HOME, XDG, git, gh, npm, and NEUMAR_APP_DATA_DIR at the
 * sandbox.
 */
export function scrubWorkerEnvironment(
  baseEnv = {},
  sandboxDir,
  tmpRoot = os.tmpdir(),
) {
  const sandbox = physicalPath(sandboxDir);
  const env = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value === undefined || !isAllowedRuntimeEnvName(name)) continue;
    env[name] = value;
  }
  env.HOME = path.join(sandbox, 'home');
  env.XDG_CONFIG_HOME = path.join(sandbox, 'xdg', 'config');
  env.XDG_CACHE_HOME = path.join(sandbox, 'xdg', 'cache');
  env.XDG_DATA_HOME = path.join(sandbox, 'xdg', 'data');
  env.XDG_STATE_HOME = path.join(sandbox, 'xdg', 'state');
  env.NEUMAR_APP_DATA_DIR = path.join(sandbox, 'app-data');
  env.TMPDIR = path.join(sandbox, 'tmp');
  env.GH_CONFIG_DIR = path.join(sandbox, 'gh');
  env.GIT_CONFIG_GLOBAL = path.join(sandbox, 'gitconfig');
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = '/bin/false';
  env.npm_config_cache = path.join(sandbox, 'npm-cache');
  return env;
}

/** Fail if the worker holds a variable outside the approved allowlist. */
export function assertWorkerEnvironment(env, tmpRoot = os.tmpdir()) {
  const violations = [];
  for (const name of Object.keys(env ?? {})) {
    if (isDeniedEnvName(name)) {
      violations.push({ rule: 'worker-env-not-allowed', name });
    }
  }
  if (env?.NEUMAR_APP_DATA_DIR !== undefined) {
    const result = assertIsolatedSandbox(env.NEUMAR_APP_DATA_DIR, tmpRoot);
    if (!result.ok) {
      violations.push({
        rule: 'worker-app-data-not-isolated',
        name: 'NEUMAR_APP_DATA_DIR',
      });
    }
  } else {
    violations.push({
      rule: 'worker-app-data-missing',
      name: 'NEUMAR_APP_DATA_DIR',
    });
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Preconditions before a worker may run. `repoAccess` is a declaration by the
 * runner; anything other than read-only is refused. The worker gets no push
 * capability, so this is a contract check rather than a sandbox primitive.
 */
export function prepareUnprivilegedWorker({
  issue,
  claim,
  branch,
  baseSha,
  sandboxDir,
  baseEnv = {},
  repoAccess = 'read-only',
  tmpRoot = os.tmpdir(),
  repoRoot,
}) {
  const violations = [];
  if (!Number.isInteger(issue) || issue <= 0) {
    violations.push({ rule: 'worker-issue-invalid', issue });
  }
  if (!claim || !isNonEmptyString(claim.runId)) {
    violations.push({ rule: 'worker-claim-invalid', field: 'runId' });
  }
  if (!Number.isInteger(claim?.epoch) || claim.epoch < 0) {
    violations.push({ rule: 'worker-claim-invalid', field: 'epoch' });
  }
  const branchCheck = assertOwnedBranch(branch, issue);
  if (!branchCheck.ok) {
    violations.push({ rule: 'worker-branch', reason: branchCheck.reason });
  }
  if (!isGitSha(baseSha)) {
    violations.push({ rule: 'worker-base-sha', reason: 'invalid' });
  }
  if (repoAccess !== 'read-only') {
    violations.push({ rule: 'worker-repo-access', repoAccess });
  }
  const sandbox = assertIsolatedSandbox(sandboxDir, tmpRoot, repoRoot);
  if (!sandbox.ok) {
    violations.push({ rule: 'worker-sandbox', reason: sandbox.reason });
  }

  let env = null;
  if (sandbox.ok) {
    env = scrubWorkerEnvironment(baseEnv, sandbox.sandboxDir, tmpRoot);
    const envCheck = assertWorkerEnvironment(env, tmpRoot);
    violations.push(...envCheck.violations);
  }

  return {
    ok: violations.length === 0,
    violations,
    context:
      violations.length === 0
        ? {
            issue,
            claim: { issue, runId: claim.runId, epoch: claim.epoch },
            branch,
            baseSha,
            sandboxDir: sandbox.sandboxDir,
            env,
            repoAccess: 'read-only',
          }
        : null,
  };
}

/** A clean abort: no patch, no PR, and a report that says why. */
export function abortWorker({
  issue,
  claim,
  branch,
  baseSha,
  reason,
  detail = null,
  sanitization,
}) {
  return createVerificationReport({
    issue,
    claim,
    branch,
    baseSha,
    headSha: null,
    reproduced: false,
    aborted: true,
    abortReason: reason,
    sanitization,
  });
}

/**
 * Finalize worker output. The report must match the worker context and the
 * actual changed files before the publisher will look at it.
 */
export function finalizeWorkerReport({ context, report, changedFiles = [] }) {
  if (!context) {
    return {
      ok: false,
      violations: [{ rule: 'worker-context-missing' }],
      report,
    };
  }
  const expected = {
    issue: context.issue,
    claim: context.claim,
    branch: context.branch,
    baseSha: context.baseSha,
    headSha: report?.headSha,
    changedFiles,
  };
  if (report?.issue !== context.issue) {
    return {
      ok: false,
      violations: [{ rule: 'worker-report-issue-mismatch' }],
      report,
    };
  }
  if (report?.claim?.runId !== context.claim.runId) {
    return {
      ok: false,
      violations: [{ rule: 'worker-report-claim-mismatch' }],
      report,
    };
  }
  if (report?.branch !== context.branch) {
    return {
      ok: false,
      violations: [{ rule: 'worker-report-branch-mismatch' }],
      report,
    };
  }
  if (report?.baseSha !== context.baseSha) {
    return {
      ok: false,
      violations: [{ rule: 'worker-report-base-mismatch' }],
      report,
    };
  }
  const result = validateVerificationReport(report, expected);
  return { ...result, report };
}
