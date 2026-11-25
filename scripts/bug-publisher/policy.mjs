// Path, branch, and frozen-debt policy for the restricted publisher (#362).
//
// Everything here is pure. The publisher runner reads the base and head
// versions of the two frozen-debt files from git and hands them in; this module
// decides whether the patch is allowed. A missing base copy is a failure, not a
// reason to skip the comparison.

import path from 'node:path';

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'Cargo.toml',
  'Cargo.lock',
]);

const POLICY_DOCS = new Set(['AGENTS.md', 'LESSONS.md', 'CLAUDE.md']);

const COMPONENT_SIZE_ALLOWLIST = 'scripts/component-size-allowlist.json';
const LINT_WARNING_BASELINE = 'scripts/lint-warning-baseline.json';

const OWNED_BRANCH = /^agent\/issue-(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const EPIC_BRANCH = /^epic\/\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Permissions a publisher installation token may hold. Anything outside this
 * table is rejected, including `workflows`, `administration`, `secrets`, and
 * signing/R2-adjacent scopes.
 */
const ALLOWED_APP_PERMISSIONS = Object.freeze({
  contents: Object.freeze(['write']),
  pull_requests: Object.freeze(['write']),
  issues: Object.freeze(['read', 'write']),
  metadata: Object.freeze(['read']),
});

function fail(rule, detail, filePath) {
  return { rule, detail, path: filePath };
}

function isUnder(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function underDirectPrefix(filePath, directory, prefix) {
  if (!filePath.startsWith(`${directory}/`)) return false;
  const first = filePath.slice(directory.length + 1).split('/')[0];
  return first.startsWith(prefix);
}

/**
 * Normalize a repository-relative path. Rejects absolute paths, traversal,
 * backslashes, NUL bytes, and empty or `.` segments instead of silently
 * normalizing them away.
 */
export function normalizeRepoPath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'empty-path' };
  }
  if (input.includes('\0')) return { ok: false, reason: 'nul-byte' };
  if (input.includes('\\')) return { ok: false, reason: 'backslash' };
  if (path.posix.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    return { ok: false, reason: 'absolute-path' };
  }
  const segments = input.split('/');
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return { ok: false, reason: 'empty-segment' };
  }
  if (segments.includes('..')) return { ok: false, reason: 'traversal' };
  return { ok: true, path: segments.join('/') };
}

/** A branch the worker may own: `agent/issue-<N>-<slug>` for this issue. */
export function assertOwnedBranch(branch, issue) {
  if (typeof branch !== 'string') {
    return { ok: false, reason: 'branch-format' };
  }
  const match = OWNED_BRANCH.exec(branch);
  if (!match) return { ok: false, reason: 'branch-format' };
  if (match[1] !== String(issue)) {
    return { ok: false, reason: 'branch-issue-mismatch' };
  }
  return { ok: true, issue: Number(match[1]), slug: match[2] };
}

/**
 * A publisher PR targets an epic branch, never `main`, a release branch, or
 * another worker's owned branch.
 */
export function assertTargetBase(base) {
  if (typeof base !== 'string' || base.length === 0) {
    return { ok: false, reason: 'target-base-missing' };
  }
  if (base === 'main' || base.startsWith('release/')) {
    return { ok: false, reason: 'target-base-protected' };
  }
  if (base.startsWith('agent/')) {
    return { ok: false, reason: 'target-base-owned-branch' };
  }
  if (!EPIC_BRANCH.test(base)) {
    return { ok: false, reason: 'target-base-not-epic' };
  }
  return { ok: true, base };
}

/**
 * The push and PR calls must use a GitHub App installation token. A personal
 * access token or the workflow `GITHUB_TOKEN` is rejected: GitHub suppresses
 * workflow runs for PRs created with `GITHUB_TOKEN`.
 */
export function assertPublisherIdentity(identity, branch) {
  const violations = [];
  if (!identity || identity.kind !== 'github-app-installation') {
    violations.push(
      fail(
        'identity-not-app',
        'publisher must use a GitHub App installation token',
      ),
    );
  }
  const permissions = identity?.permissions ?? {};
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    violations.push(fail('identity-permissions-invalid', 'permissions'));
  } else {
    for (const [name, level] of Object.entries(permissions)) {
      const allowed = ALLOWED_APP_PERMISSIONS[name];
      if (!allowed) {
        violations.push(
          fail(
            'identity-forbidden-permission',
            `installation token must not hold ${name}`,
          ),
        );
        continue;
      }
      if (!allowed.includes(level)) {
        violations.push(
          fail(
            'identity-permission-too-broad',
            `${name}: ${level} is not one of ${allowed.join(', ')}`,
          ),
        );
      }
    }
    if (permissions.contents !== 'write') {
      violations.push(
        fail('identity-missing-permission', 'contents: write is required'),
      );
    }
    if (permissions.pull_requests !== 'write') {
      violations.push(
        fail('identity-missing-permission', 'pull_requests: write is required'),
      );
    }
  }
  const scope = identity?.branchScope;
  if (!Array.isArray(scope) || scope.length !== 1 || scope[0] !== branch) {
    violations.push(
      fail(
        'identity-branch-scope',
        'publisher may only touch the owned branch',
      ),
    );
  }
  return { ok: violations.length === 0, violations };
}

function parseJsonObject(value, label, violations, filePath) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      violations.push(
        fail('invalid-json', `${label} is not valid JSON`, filePath),
      );
      return null;
    }
  }
  violations.push(fail('invalid-json', `${label} is not an object`, filePath));
  return null;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function findAllowlistViolations(base, head, violations) {
  const baseEntries = base ?? {};
  const headEntries = head ?? {};
  for (const [file, entry] of Object.entries(headEntries)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      violations.push(
        fail(
          'allowlist-entry-invalid',
          `${file} is not an entry object`,
          COMPONENT_SIZE_ALLOWLIST,
        ),
      );
      continue;
    }
    if (!Number.isInteger(entry.current) || entry.current < 0) {
      violations.push(
        fail(
          'allowlist-entry-invalid',
          `${file} has no integer current ceiling`,
          COMPONENT_SIZE_ALLOWLIST,
        ),
      );
      continue;
    }
    const previous = baseEntries[file];
    if (!previous) {
      violations.push(
        fail(
          'allowlist-ceiling-increase',
          `${file} adds a new allowlist entry`,
          COMPONENT_SIZE_ALLOWLIST,
        ),
      );
      continue;
    }
    if (!Number.isInteger(previous.current) || previous.current < 0) {
      violations.push(
        fail(
          'allowlist-base-invalid',
          `${file} has no integer base ceiling`,
          COMPONENT_SIZE_ALLOWLIST,
        ),
      );
      continue;
    }
    if (entry.current > previous.current) {
      violations.push(
        fail(
          'allowlist-ceiling-increase',
          `${file} raised ${previous.current} to ${entry.current}`,
          COMPONENT_SIZE_ALLOWLIST,
        ),
      );
    }
  }
}

function compareCountSection(base, head, violations) {
  const baseEntries = base ?? {};
  const headEntries = head ?? {};
  for (const [file, rules] of Object.entries(headEntries)) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      violations.push(
        fail(
          'warning-baseline-invalid',
          `${file} has no rule map`,
          LINT_WARNING_BASELINE,
        ),
      );
      continue;
    }
    for (const [rule, count] of Object.entries(rules)) {
      if (!isCount(count)) {
        violations.push(
          fail(
            'warning-baseline-invalid',
            `${file} ${rule} is not a non-negative integer`,
            LINT_WARNING_BASELINE,
          ),
        );
        continue;
      }
      const previous = baseEntries?.[file]?.[rule] ?? 0;
      if (!isCount(previous)) {
        violations.push(
          fail(
            'warning-baseline-base-invalid',
            `${file} ${rule} has an invalid base count`,
            LINT_WARNING_BASELINE,
          ),
        );
        continue;
      }
      if (count > previous) {
        violations.push(
          fail(
            'warning-baseline-growth',
            `${file} ${rule} grew from ${previous} to ${count}`,
            LINT_WARNING_BASELINE,
          ),
        );
      }
    }
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function findWarningBaselineViolations(base, head, violations) {
  if (head.version !== base.version) {
    violations.push(
      fail(
        'warning-baseline-version',
        `version changed from ${base.version} to ${head.version}`,
        LINT_WARNING_BASELINE,
      ),
    );
  }
  for (const section of ['warnings', 'suppressions']) {
    const value = head[section];
    if (
      value !== undefined &&
      (value === null || typeof value !== 'object' || Array.isArray(value))
    ) {
      violations.push(
        fail(
          'warning-baseline-invalid',
          `${section} is not an object`,
          LINT_WARNING_BASELINE,
        ),
      );
    }
  }
  if (head.exceptions !== undefined && !Array.isArray(head.exceptions)) {
    violations.push(
      fail(
        'warning-baseline-invalid',
        'exceptions is not an array',
        LINT_WARNING_BASELINE,
      ),
    );
  }
  compareCountSection(base.warnings, head.warnings, violations);
  compareCountSection(base.suppressions, head.suppressions, violations);
  const baseExceptions = new Set(
    (Array.isArray(base.exceptions) ? base.exceptions : []).map(
      stableStringify,
    ),
  );
  for (const exception of Array.isArray(head.exceptions)
    ? head.exceptions
    : []) {
    if (!baseExceptions.has(stableStringify(exception))) {
      violations.push(
        fail(
          'warning-baseline-new-exception',
          'a new or edited exception is not allowed in a bug-fix patch',
          LINT_WARNING_BASELINE,
        ),
      );
    }
  }
}

/**
 * Decide whether a patch may be pushed. `authorizedPaths` comes from the
 * trusted approval record, not from issue text; it only unlocks dependency
 * manifests and lockfiles, never the hard deny-list.
 */
export function evaluatePatchPolicy({
  changedFiles = [],
  authorizedPaths = [],
  componentSizeBase,
  componentSizeHead,
  warningBaselineBase,
  warningBaselineHead,
} = {}) {
  const violations = [];
  const normalized = [];

  for (const entry of changedFiles) {
    const candidates =
      typeof entry === 'string'
        ? [{ path: entry }]
        : [
            { path: entry?.path },
            ...(entry?.previousPath ? [{ path: entry.previousPath }] : []),
          ];
    for (const candidate of candidates) {
      const result = normalizeRepoPath(candidate.path);
      if (!result.ok) {
        violations.push(
          fail('invalid-path', result.reason, String(candidate.path)),
        );
        continue;
      }
      normalized.push(result.path);
    }
  }

  const authorized = new Set();
  for (const candidate of authorizedPaths) {
    const result = normalizeRepoPath(candidate);
    if (!result.ok) {
      violations.push(
        fail('invalid-authorized-path', result.reason, String(candidate)),
      );
      continue;
    }
    if (/[*?[\]]/.test(result.path)) {
      violations.push(
        fail(
          'invalid-authorized-path',
          'authorization must name an exact path',
          result.path,
        ),
      );
      continue;
    }
    authorized.add(result.path);
  }

  const unique = [...new Set(normalized)];
  let touchesAllowlist = false;
  let touchesBaseline = false;

  for (const filePath of unique) {
    const basename = filePath.split('/').pop();
    if (
      isUnder(filePath, '.github') ||
      isUnder(filePath, 'src-tauri/capabilities') ||
      filePath === 'src-tauri/tauri.conf.json' ||
      filePath === 'src-tauri/entitlements.plist' ||
      underDirectPrefix(filePath, 'scripts', 'release') ||
      underDirectPrefix(filePath, 'scripts', 'publish') ||
      underDirectPrefix(filePath, 'scripts', 'r2-upload') ||
      filePath === 'scripts/build.sh' ||
      underDirectPrefix(filePath, 'scripts', 'sign-') ||
      isUnder(filePath, 'branding') ||
      filePath === 'branding.json' ||
      POLICY_DOCS.has(filePath)
    ) {
      violations.push(fail('denied-path', 'hard deny-list', filePath));
      continue;
    }
    if (MANIFEST_BASENAMES.has(basename) && !authorized.has(filePath)) {
      violations.push(
        fail(
          'unauthorized-manifest',
          'dependency manifest or lockfile is not authorized',
          filePath,
        ),
      );
      continue;
    }
    if (filePath === COMPONENT_SIZE_ALLOWLIST) touchesAllowlist = true;
    if (filePath === LINT_WARNING_BASELINE) touchesBaseline = true;
  }

  if (touchesAllowlist) {
    if (componentSizeBase === undefined || componentSizeHead === undefined) {
      violations.push(
        fail(
          'missing-base-content',
          'base and head allowlists are required',
          COMPONENT_SIZE_ALLOWLIST,
        ),
      );
    } else {
      const base = parseJsonObject(
        componentSizeBase,
        'base allowlist',
        violations,
        COMPONENT_SIZE_ALLOWLIST,
      );
      const head = parseJsonObject(
        componentSizeHead,
        'head allowlist',
        violations,
        COMPONENT_SIZE_ALLOWLIST,
      );
      if (base && head) findAllowlistViolations(base, head, violations);
    }
  }

  if (touchesBaseline) {
    if (
      warningBaselineBase === undefined ||
      warningBaselineHead === undefined
    ) {
      violations.push(
        fail(
          'missing-base-content',
          'base and head warning baselines are required',
          LINT_WARNING_BASELINE,
        ),
      );
    } else {
      const base = parseJsonObject(
        warningBaselineBase,
        'base warning baseline',
        violations,
        LINT_WARNING_BASELINE,
      );
      const head = parseJsonObject(
        warningBaselineHead,
        'head warning baseline',
        violations,
        LINT_WARNING_BASELINE,
      );
      if (base && head) {
        findWarningBaselineViolations(base, head, violations);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    changedFiles: unique.sort(),
  };
}
