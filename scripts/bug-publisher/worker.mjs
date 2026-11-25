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

import os from 'node:os';
import path from 'node:path';

const DENIED_ENV_NAMES = new Set([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITHUB_PAT',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_CACHE_URL',
  'ACTIONS_RESULTS_URL',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GPG_AGENT_INFO',
  'KUBECONFIG',
  'DOCKER_CONFIG',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'YARN_NPM_AUTH_TOKEN',
  'CARGO_REGISTRY_TOKEN',
  'TWINE_PASSWORD',
]);

const DENIED_ENV_PREFIXES = [
  'GH_',
  'GITHUB_',
  'ACTIONS_',
  'PUBLISHER_',
  'NEUMAR_PUBLISHER_',
  'AWS_',
  'R2_',
  'CLOUDFLARE_',
  'SIGNING_',
  'TAURI_SIGNING_',
  'APPLE_',
  'CSC_',
  'NOTARIZATION_',
  'MACOS_SIGNING_',
];

// Paths the worker sets itself. `GH_` is otherwise a credential prefix, but
// this variable only relocates gh's config directory into the sandbox.
const ALLOWED_ENV_NAMES = new Set(['GH_CONFIG_DIR']);

export function isDeniedEnvName(name) {
  if (ALLOWED_ENV_NAMES.has(name)) return false;
  if (DENIED_ENV_NAMES.has(name)) return true;
  return DENIED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
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
  const resolved = path.resolve(sandboxDir);
  const home = path.resolve(os.homedir());
  const root = path.resolve(tmpRoot);
  if (resolved === home || resolved.startsWith(`${home}${path.sep}`)) {
    return { ok: false, reason: 'sandbox-inside-home' };
  }
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return { ok: false, reason: 'sandbox-outside-temp' };
  }
  if (repoRoot) {
    const repo = path.resolve(repoRoot);
    if (resolved === repo || resolved.startsWith(`${repo}${path.sep}`)) {
      return { ok: false, reason: 'sandbox-inside-repo' };
    }
  }
  return { ok: true, sandboxDir: resolved };
}

/**
 * Build the worker environment: remove every publish/release credential, and
 * point HOME, XDG, git, gh, npm, and NEUMAR_APP_DATA_DIR at the sandbox.
 */
export function scrubWorkerEnvironment(
  baseEnv = {},
  sandboxDir,
  tmpRoot = os.tmpdir(),
) {
  const sandbox = path.resolve(sandboxDir);
  const env = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value === undefined || isDeniedEnvName(name)) continue;
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

/** Fail if a credential that the worker must never hold is still present. */
export function assertWorkerEnvironment(env, tmpRoot = os.tmpdir()) {
  const violations = [];
  for (const name of Object.keys(env ?? {})) {
    if (isDeniedEnvName(name)) {
      violations.push({ rule: 'worker-credential-present', name });
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
