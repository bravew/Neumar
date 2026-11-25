import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  abortWorker,
  assertAppTokenLeastPrivilege,
  assertIsolatedSandbox,
  assertOwnedBranch,
  assertPublisherIdentity,
  assertSafePush,
  assertTargetBase,
  assertWorkerEnvironment,
  buildPullRequestBody,
  createAppJwt,
  createInstallationTokenFromEnv,
  evaluatePatchPolicy,
  finalizeWorkerReport,
  findClosingIssues,
  isDeniedEnvName,
  loadPublisherAppCredentials,
  normalizeRepoPath,
  prepareUnprivilegedWorker,
  publishBugFix,
  REPORT_VERSION,
  requiredChecksForFiles,
  scrubWorkerEnvironment,
  validateVerificationReport,
  type FetchLike,
  type FreshIssue,
  type PublishOptions,
  type PublisherGithub,
  type PullRequestInfo,
  type VerificationReport,
} from '../../../scripts/bug-publisher/index.mjs';

// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Contract coverage for #362's unprivileged worker and restricted publisher.
 *
 * Every external effect is injected: no test runs git, gh, a real GitHub API
 * call, or a model. The App-token tests generate a throwaway RSA key and use a
 * fake fetch; no real credential is read. The sandbox is a temp directory, so
 * the suite never touches the host home.
 */

const ISSUE = 362;
const BRANCH = 'agent/issue-362-bug-publisher';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const REMOTE = 'c'.repeat(40);
const BOT = 'neumar-publisher[bot]';
const TARGET_BASE = 'epic/358-cloud-bug-monitor';

// The worker compares physical paths, and macOS `tmpdir()` is a symlink.
const SANDBOX_ROOT = realpathSync(
  mkdtempSync(path.join(os.tmpdir(), 'neumar-362-')),
);
const APP_DATA_DIR = path.join(SANDBOX_ROOT, 'app-data');

afterAll(() => {
  rmSync(SANDBOX_ROOT, { recursive: true, force: true });
});

type FullReport = VerificationReport &
  Required<
    Pick<
      VerificationReport,
      'regression' | 'checks' | 'changedFiles' | 'prTemplate' | 'unverified'
    >
  >;

function validReport(overrides: Partial<FullReport> = {}): FullReport {
  const report: FullReport = {
    version: REPORT_VERSION,
    issue: ISSUE,
    claim: { issue: ISSUE, runId: 'run-1', epoch: 7 },
    branch: BRANCH,
    baseSha: BASE,
    headSha: HEAD,
    reproduced: true,
    aborted: false,
    abortReason: null,
    sanitization: {
      appDataDir: APP_DATA_DIR,
      hostHomeUntouched: true,
      thirdPartyCalls: 'stubbed',
      credentialsPresent: false,
    },
    regression: {
      testPath: 'src/__tests__/scripts/bugPublisher.test.ts',
      command: 'pnpm test src/__tests__/scripts/bugPublisher.test.ts',
      callerBoundary: 'publishBugFix',
      failsOnBase: true,
      passesOnHead: true,
      baseSha: BASE,
      headSha: HEAD,
    },
    checks: [
      {
        name: 'pnpm validate',
        status: 'passed',
        command: 'pnpm validate',
        evidence: 'exit 0',
      },
    ],
    changedFiles: ['scripts/bug-publisher/publisher.mjs'],
    prTemplate: {
      title: 'fix(publisher): isolate the bug fix push and PR',
      exactHeadSha: HEAD,
      nodeVersion: 'v22.20.0',
      pnpmVersion: '10.15.0',
      intent: 'Publish one verified fix for one approved bug.',
      affectedContracts: 'Publisher policy and verification report.',
      verificationSummary:
        'Regression test fails on the pinned base and passes on this head.',
      unverified: [],
      attribution: {
        accountableContributor: 'bravew',
        authoringTool: 'Claude Code',
        sessionReference: 'opaque-session-1',
      },
      corrective: 'not applicable',
      closesIssue: ISSUE,
    },
    unverified: [],
  };
  return { ...report, ...overrides };
}

function approvedIssue() {
  return {
    number: ISSUE,
    state: 'open',
    isPullRequest: false,
    labels: ['bug', 'agent:bug-approved'],
  };
}

function appIdentity() {
  return {
    kind: 'github-app-installation',
    permissions: {
      contents: 'write',
      pull_requests: 'write',
      issues: 'write',
      metadata: 'read',
    },
    branchScope: [BRANCH],
  };
}

interface GithubFake {
  github: PublisherGithub;
  prs: PullRequestInfo[];
  listOpenPullRequests: ReturnType<typeof vi.fn>;
  createPullRequest: ReturnType<typeof vi.fn>;
  updatePullRequest: ReturnType<typeof vi.fn>;
}

function createGithubFake(
  initial: PullRequestInfo[] = [],
  { failCreateAfterWrite = false } = {},
): GithubFake {
  const prs = initial.map((pullRequest) => ({ ...pullRequest }));
  let nextNumber = 100;
  const listOpenPullRequests = vi.fn(async () =>
    prs.map((pullRequest) => ({ ...pullRequest })),
  );
  const createPullRequest = vi.fn(
    async (input: {
      head: string;
      base: string;
      title: string;
      body: string;
    }) => {
      const number = nextNumber;
      nextNumber += 1;
      const pullRequest: PullRequestInfo = {
        number,
        headRefName: input.head,
        state: 'open',
        body: input.body,
        url: `https://example.test/pull/${number}`,
      };
      prs.push(pullRequest);
      if (failCreateAfterWrite) throw new Error('socket hang up');
      return pullRequest;
    },
  );
  const updatePullRequest = vi.fn(
    async (input: { number: number; title: string; body: string }) => {
      const pullRequest = prs.find((entry) => entry.number === input.number);
      if (pullRequest) pullRequest.body = input.body;
      return pullRequest ?? { number: input.number };
    },
  );
  return {
    github: {
      listOpenPullRequests,
      createPullRequest,
      updatePullRequest,
    },
    prs,
    listOpenPullRequests,
    createPullRequest,
    updatePullRequest,
  };
}

function createGitFake() {
  const push = vi.fn(async () => {});
  return { git: { push }, push };
}

function validOptions(overrides: Partial<PublishOptions> = {}): PublishOptions {
  const github = createGithubFake();
  const git = createGitFake();
  return {
    issue: ISSUE,
    claim: { runId: 'run-1', epoch: 7 },
    branch: BRANCH,
    baseSha: BASE,
    localHead: HEAD,
    remoteHead: null,
    commitsAhead: [{ sha: HEAD, authorLogin: BOT }],
    botLogin: BOT,
    isAncestor: () => true,
    now: '2026-11-24T12:00:00.000Z',
    report: validReport(),
    changedFiles: ['scripts/bug-publisher/publisher.mjs'],
    identity: appIdentity(),
    targetBase: TARGET_BASE,
    trustedActors: [{ login: 'bravew', association: 'OWNER' }],
    readState: async () => ({ disabled: false, claims: {} }),
    verifyClaim: () => ({ ok: true, reason: 'ok' }),
    readFreshIssue: async () => approvedIssue(),
    resolveApproval: () => ({ status: 'approved', actor: 'bravew' }),
    git: git.git,
    github: github.github,
    ...overrides,
  };
}

describe('path policy', () => {
  it('rejects every hard deny-list category', () => {
    const denied = [
      '.github/workflows/ci.yml',
      '.github/PULL_REQUEST_TEMPLATE.md',
      'src-tauri/capabilities/default.json',
      'src-tauri/tauri.conf.json',
      'src-tauri/entitlements.plist',
      'scripts/release.sh',
      'scripts/release.mjs',
      'scripts/release-local-r2-mac-arm.sh',
      'scripts/publish.sh',
      'scripts/r2-upload.sh',
      'scripts/build.sh',
      'scripts/sign-dev-macos.sh',
      'branding/default/icon.svg',
      'branding.json',
      'AGENTS.md',
      'LESSONS.md',
      'CLAUDE.md',
    ];
    for (const filePath of denied) {
      const result = evaluatePatchPolicy({ changedFiles: [filePath] });
      expect(result.ok, filePath).toBe(false);
      expect(
        result.violations.map((entry) => entry.rule),
        filePath,
      ).toContain('denied-path');
    }
  });

  it('rejects dependency manifests and lockfiles unless exactly authorized', () => {
    const manifests = [
      'package.json',
      'src-api/package.json',
      'packages/video-ir/package.json',
      'pnpm-lock.yaml',
      'src-tauri/Cargo.toml',
      'Cargo.lock',
    ];
    for (const filePath of manifests) {
      const result = evaluatePatchPolicy({ changedFiles: [filePath] });
      expect(result.ok, filePath).toBe(false);
      expect(
        result.violations.map((entry) => entry.rule),
        filePath,
      ).toContain('unauthorized-manifest');
    }

    const authorized = evaluatePatchPolicy({
      changedFiles: ['src-api/package.json'],
      authorizedPaths: ['src-api/package.json'],
    });
    expect(authorized.ok).toBe(true);

    const wildcard = evaluatePatchPolicy({
      changedFiles: ['src-api/package.json'],
      authorizedPaths: ['src-api/*'],
    });
    expect(wildcard.ok).toBe(false);
    expect(wildcard.violations.map((entry) => entry.rule)).toContain(
      'invalid-authorized-path',
    );
  });

  it('allows ordinary source, test, script, and doc paths', () => {
    const result = evaluatePatchPolicy({
      changedFiles: [
        'src/app/pages/Foo.tsx',
        'src-api/src/app/api/foo.ts',
        'scripts/bug-publisher/policy.mjs',
        'doc/maintenance/cloud-bug-publisher.md',
        'src/__tests__/scripts/bugPublisher.test.ts',
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects unsafe path spellings instead of normalizing them away', () => {
    expect(normalizeRepoPath('../etc/passwd')).toEqual({
      ok: false,
      reason: 'traversal',
    });
    expect(normalizeRepoPath('/etc/passwd')).toEqual({
      ok: false,
      reason: 'absolute-path',
    });
    expect(normalizeRepoPath('src\\foo.ts')).toEqual({
      ok: false,
      reason: 'backslash',
    });
    expect(normalizeRepoPath('src//foo.ts')).toEqual({
      ok: false,
      reason: 'empty-segment',
    });
    expect(normalizeRepoPath('src/./foo.ts')).toEqual({
      ok: false,
      reason: 'empty-segment',
    });
    expect(normalizeRepoPath('src/foo\0.ts')).toEqual({
      ok: false,
      reason: 'nul-byte',
    });
    expect(normalizeRepoPath('src/foo.ts')).toEqual({
      ok: true,
      path: 'src/foo.ts',
    });

    const result = evaluatePatchPolicy({ changedFiles: ['../escape.ts'] });
    expect(result.ok).toBe(false);
    expect(result.violations.map((entry) => entry.rule)).toContain(
      'invalid-path',
    );
  });

  it('rejects a raised component-size ceiling but allows a reduction', () => {
    const base = {
      'src/components/A.tsx': { current: 400, target: 350 },
    };
    const raised = evaluatePatchPolicy({
      changedFiles: ['scripts/component-size-allowlist.json'],
      componentSizeBase: base,
      componentSizeHead: {
        'src/components/A.tsx': { current: 401, target: 350 },
      },
    });
    expect(raised.ok).toBe(false);
    expect(raised.violations.map((entry) => entry.rule)).toContain(
      'allowlist-ceiling-increase',
    );

    const lowered = evaluatePatchPolicy({
      changedFiles: ['scripts/component-size-allowlist.json'],
      componentSizeBase: base,
      componentSizeHead: {
        'src/components/A.tsx': { current: 399, target: 350 },
      },
    });
    expect(lowered.ok).toBe(true);

    const removed = evaluatePatchPolicy({
      changedFiles: ['scripts/component-size-allowlist.json'],
      componentSizeBase: base,
      componentSizeHead: {},
    });
    expect(removed.ok).toBe(true);

    const newEntry = evaluatePatchPolicy({
      changedFiles: ['scripts/component-size-allowlist.json'],
      componentSizeBase: base,
      componentSizeHead: {
        'src/components/A.tsx': { current: 400, target: 350 },
        'src/components/B.tsx': { current: 360, target: 350 },
      },
    });
    expect(newEntry.ok).toBe(false);
    expect(newEntry.violations.map((entry) => entry.rule)).toContain(
      'allowlist-ceiling-increase',
    );

    const missingBase = evaluatePatchPolicy({
      changedFiles: ['scripts/component-size-allowlist.json'],
    });
    expect(missingBase.ok).toBe(false);
    expect(missingBase.violations.map((entry) => entry.rule)).toContain(
      'missing-base-content',
    );
  });

  it('rejects new warnings, suppressions, and exceptions in the lint baseline', () => {
    const base = {
      version: 2,
      warnings: { 'src/a.tsx': { 'react(refs)': 1 } },
      suppressions: { 'src/a.tsx': { 'react-hooks(exhaustive-deps)': 1 } },
      exceptions: [],
    };
    const file = 'scripts/lint-warning-baseline.json';

    const warningGrowth = evaluatePatchPolicy({
      changedFiles: [file],
      warningBaselineBase: base,
      warningBaselineHead: {
        ...base,
        warnings: { 'src/a.tsx': { 'react(refs)': 2 } },
      },
    });
    expect(warningGrowth.ok).toBe(false);
    expect(warningGrowth.violations.map((entry) => entry.rule)).toContain(
      'warning-baseline-growth',
    );

    const suppressionGrowth = evaluatePatchPolicy({
      changedFiles: [file],
      warningBaselineBase: base,
      warningBaselineHead: {
        ...base,
        suppressions: { 'src/a.tsx': { 'react(refs)': 1 } },
      },
    });
    expect(suppressionGrowth.ok).toBe(false);
    expect(suppressionGrowth.violations.map((entry) => entry.rule)).toContain(
      'warning-baseline-growth',
    );

    const newException = evaluatePatchPolicy({
      changedFiles: [file],
      warningBaselineBase: base,
      warningBaselineHead: {
        ...base,
        exceptions: [{ kind: 'growth', file: 'src/a.tsx' }],
      },
    });
    expect(newException.ok).toBe(false);
    expect(newException.violations.map((entry) => entry.rule)).toContain(
      'warning-baseline-new-exception',
    );

    const versionChange = evaluatePatchPolicy({
      changedFiles: [file],
      warningBaselineBase: base,
      warningBaselineHead: { ...base, version: 3 },
    });
    expect(versionChange.ok).toBe(false);
    expect(versionChange.violations.map((entry) => entry.rule)).toContain(
      'warning-baseline-version',
    );

    const reduction = evaluatePatchPolicy({
      changedFiles: [file],
      warningBaselineBase: base,
      warningBaselineHead: {
        version: 2,
        warnings: {},
        suppressions: {},
        exceptions: [],
      },
    });
    expect(reduction.ok).toBe(true);
  });
});

describe('branch and identity policy', () => {
  it('accepts only the owned branch for the claimed issue', () => {
    expect(assertOwnedBranch(BRANCH, ISSUE)).toMatchObject({ ok: true });
    expect(assertOwnedBranch('agent/issue-363-other', ISSUE)).toMatchObject({
      ok: false,
      reason: 'branch-issue-mismatch',
    });
    expect(assertOwnedBranch('agent/issue-0362-bug', ISSUE)).toMatchObject({
      ok: false,
      reason: 'branch-issue-mismatch',
    });
    for (const branch of [
      'main',
      'epic/358-cloud-bug-monitor',
      'agent/issue-362-',
      'agent/issue-362-Bad',
      'agent/issue-362-a/b',
    ]) {
      expect(assertOwnedBranch(branch, ISSUE).ok, branch).toBe(false);
    }
  });

  it('targets an epic branch, never main or another owned branch', () => {
    expect(assertTargetBase(TARGET_BASE).ok).toBe(true);
    expect(assertTargetBase('main')).toMatchObject({
      ok: false,
      reason: 'target-base-protected',
    });
    expect(assertTargetBase('release/v1')).toMatchObject({
      ok: false,
      reason: 'target-base-protected',
    });
    expect(assertTargetBase('agent/issue-1-x')).toMatchObject({
      ok: false,
      reason: 'target-base-owned-branch',
    });
    expect(assertTargetBase('feature/x')).toMatchObject({
      ok: false,
      reason: 'target-base-not-epic',
    });
  });

  it('requires a least-privilege GitHub App installation identity', () => {
    expect(assertPublisherIdentity(appIdentity(), BRANCH).ok).toBe(true);
    expect(
      assertPublisherIdentity(
        { ...appIdentity(), kind: 'personal-access-token' },
        BRANCH,
      ).ok,
    ).toBe(false);
    expect(
      assertPublisherIdentity(
        {
          ...appIdentity(),
          permissions: {
            ...appIdentity().permissions,
            workflows: 'write',
          },
        },
        BRANCH,
      ).violations.map((entry) => entry.rule),
    ).toContain('identity-forbidden-permission');
    expect(
      assertPublisherIdentity(
        {
          ...appIdentity(),
          permissions: { ...appIdentity().permissions, contents: 'read' },
        },
        BRANCH,
      ).ok,
    ).toBe(false);
    expect(
      assertPublisherIdentity(
        { ...appIdentity(), branchScope: ['agent/issue-1-other'] },
        BRANCH,
      ).violations.map((entry) => entry.rule),
    ).toContain('identity-branch-scope');
  });
});

describe('verification report', () => {
  const expected = {
    issue: ISSUE,
    claim: { issue: ISSUE, runId: 'run-1', epoch: 7 },
    branch: BRANCH,
    baseSha: BASE,
    headSha: HEAD,
    changedFiles: ['scripts/bug-publisher/publisher.mjs'],
  };

  it('accepts a complete report for the exact head and base', () => {
    expect(validateVerificationReport(validReport(), expected)).toEqual({
      ok: true,
      violations: [],
    });
  });

  it('requires the regression test to fail on base and pass on head', () => {
    for (const change of [{ failsOnBase: false }, { passesOnHead: false }]) {
      const result = validateVerificationReport(
        validReport({
          regression: { ...validReport().regression, ...change },
        }),
        expected,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.map((entry) => entry.rule)).toContain(
        change.failsOnBase === false
          ? 'regression-not-failing-on-base'
          : 'regression-not-passing-on-head',
      );
    }
  });

  it('refuses a report that did not reproduce the bug', () => {
    const result = validateVerificationReport(
      validReport({ reproduced: false }),
      expected,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((entry) => entry.rule)).toContain(
      'report-not-reproduced',
    );
  });

  it('refuses base or head drift', () => {
    const wrongBase = validateVerificationReport(
      validReport({ baseSha: REMOTE }),
      expected,
    );
    expect(wrongBase.violations.map((entry) => entry.rule)).toContain(
      'report-base',
    );
    const wrongHead = validateVerificationReport(
      validReport({ headSha: REMOTE }),
      expected,
    );
    expect(wrongHead.violations.map((entry) => entry.rule)).toContain(
      'report-head',
    );
  });

  it('requires pnpm validate and the checks for the changed surface', () => {
    const missing = validateVerificationReport(
      validReport({ checks: [] }),
      expected,
    );
    expect(missing.violations.map((entry) => entry.rule)).toContain(
      'check-missing',
    );

    const apiReport = validReport({
      changedFiles: ['src-api/src/foo.ts'],
      checks: [{ name: 'pnpm validate', status: 'passed' }],
    });
    const apiResult = validateVerificationReport(apiReport, {
      ...expected,
      changedFiles: ['src-api/src/foo.ts'],
    });
    expect(apiResult.violations.map((entry) => entry.rule)).toContain(
      'check-missing',
    );
    expect(requiredChecksForFiles(['src-api/src/foo.ts'])).toContain(
      'pnpm --filter neumar-api lint',
    );
    expect(requiredChecksForFiles(['src-tauri/src/lib.rs'])).toContain(
      'cargo check --manifest-path src-tauri/Cargo.toml --locked',
    );

    const skipped = validateVerificationReport(
      validReport({
        checks: [{ name: 'pnpm validate', status: 'skipped', reason: 'x' }],
      }),
      expected,
    );
    expect(skipped.violations.map((entry) => entry.rule)).toContain(
      'check-not-passed',
    );
  });

  it('rejects a duplicated check name and a command that does not match', () => {
    const duplicated = validateVerificationReport(
      validReport({
        checks: [
          { name: 'pnpm validate', status: 'passed', command: 'pnpm validate' },
          { name: 'pnpm validate', status: 'failed', command: 'pnpm validate' },
        ],
      }),
      expected,
    );
    expect(duplicated.ok).toBe(false);
    expect(duplicated.violations.map((entry) => entry.rule)).toContain(
      'check-duplicate',
    );

    for (const command of ['echo ok', undefined]) {
      const mismatched = validateVerificationReport(
        validReport({
          checks: [{ name: 'pnpm validate', status: 'passed', command }],
        }),
        expected,
      );
      expect(mismatched.ok, String(command)).toBe(false);
      expect(mismatched.violations.map((entry) => entry.rule)).toContain(
        'check-command-mismatch',
      );
    }
  });

  it('requires the reported file set to match the patch', () => {
    const result = validateVerificationReport(
      validReport({ changedFiles: ['src/other.ts'] }),
      expected,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((entry) => entry.rule)).toContain(
      'report-changed-files',
    );
  });

  it('requires sanitized, isolated reproduction', () => {
    for (const [sanitization, rule] of [
      [
        { ...validReport().sanitization, hostHomeUntouched: false },
        'sanitization-home-untouched',
      ],
      [
        { ...validReport().sanitization, thirdPartyCalls: 'live' },
        'sanitization-third-party',
      ],
      [
        { ...validReport().sanitization, credentialsPresent: true },
        'sanitization-credentials',
      ],
      [
        {
          ...validReport().sanitization,
          appDataDir: path.join(os.homedir(), 'x'),
        },
        'sanitization-home',
      ],
    ] as const) {
      const result = validateVerificationReport(
        validReport({ sanitization }),
        expected,
      );
      expect(result.violations.map((entry) => entry.rule)).toContain(rule);
    }
  });

  it('requires accurate PR template fields and closes only the bug issue', () => {
    const longTitle = validateVerificationReport(
      validReport({
        prTemplate: {
          ...validReport().prTemplate,
          title: 'x'.repeat(71),
        },
      }),
      expected,
    );
    expect(longTitle.violations.map((entry) => entry.rule)).toContain(
      'pr-title-too-long',
    );

    const wrongHead = validateVerificationReport(
      validReport({
        prTemplate: {
          ...validReport().prTemplate,
          exactHeadSha: REMOTE,
        },
      }),
      expected,
    );
    expect(wrongHead.violations.map((entry) => entry.rule)).toContain(
      'pr-head-mismatch',
    );

    const wrongIssue = validateVerificationReport(
      validReport({
        prTemplate: { ...validReport().prTemplate, closesIssue: 358 },
      }),
      expected,
    );
    expect(wrongIssue.violations.map((entry) => entry.rule)).toContain(
      'pr-closes-issue',
    );

    const missingAttribution = validateVerificationReport(
      validReport({
        prTemplate: {
          ...validReport().prTemplate,
          attribution: {
            accountableContributor: '',
            authoringTool: '',
            sessionReference: '',
          },
        },
      }),
      expected,
    );
    expect(missingAttribution.violations.map((entry) => entry.rule)).toContain(
      'pr-attribution',
    );
  });

  it('renders a PR body with the exact head and only the bug issue', () => {
    const body = buildPullRequestBody(validReport());
    expect(body).toContain(`Exact checked commit SHA: \`${HEAD}\``);
    expect(body).toContain('Closes #362');
    expect(body).toContain('v22.20.0 / 10.15.0');
    expect(findClosingIssues(body)).toEqual([ISSUE]);
    expect(findClosingIssues('Closes #362 and fixes #358')).toEqual([362, 358]);
    expect(findClosingIssues('Closes: #362\nFixes: #358')).toEqual([362, 358]);
  });
});

describe('unprivileged worker', () => {
  it('scrubs every publish, release, signing, and R2 credential', () => {
    const baseEnv = {
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      NEUMAR_MODEL_KEY: 'model-only',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.sshCommand',
      GIT_CONFIG_VALUE_0: 'curl http://example.test',
      GIT_SSH_COMMAND: 'ssh -i /key',
      NODE_OPTIONS: '--require /tmp/x.js',
      AZURE_CLIENT_SECRET: 'secret',
      OPENAI_API_KEY: 'secret',
      HOME: os.homedir(),
      GH_TOKEN: 'secret',
      GITHUB_TOKEN: 'secret',
      PUBLISHER_APP_PRIVATE_KEY: 'secret',
      PUBLISHER_APP_ID: '123',
      AWS_SECRET_ACCESS_KEY: 'secret',
      R2_ACCESS_KEY_ID: 'secret',
      CLOUDFLARE_API_TOKEN: 'secret',
      TAURI_SIGNING_PRIVATE_KEY: 'secret',
      APPLE_ID: 'secret',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
    };
    const env = scrubWorkerEnvironment(baseEnv, SANDBOX_ROOT);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.NEUMAR_MODEL_KEY).toBe('model-only');
    for (const denied of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'PUBLISHER_APP_PRIVATE_KEY',
      'PUBLISHER_APP_ID',
      'AWS_SECRET_ACCESS_KEY',
      'R2_ACCESS_KEY_ID',
      'CLOUDFLARE_API_TOKEN',
      'TAURI_SIGNING_PRIVATE_KEY',
      'APPLE_ID',
      'SSH_AUTH_SOCK',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'GIT_SSH_COMMAND',
      'NODE_OPTIONS',
      'AZURE_CLIENT_SECRET',
      'OPENAI_API_KEY',
    ]) {
      expect(env[denied], denied).toBeUndefined();
    }
    expect(env.NEUMAR_APP_DATA_DIR).toBe(path.join(SANDBOX_ROOT, 'app-data'));
    expect(env.HOME).toBe(path.join(SANDBOX_ROOT, 'home'));
    expect(env.HOME).not.toBe(os.homedir());
    expect(env.XDG_CONFIG_HOME).toBe(path.join(SANDBOX_ROOT, 'xdg', 'config'));
    expect(isDeniedEnvName('GH_TOKEN')).toBe(true);
    expect(isDeniedEnvName('GIT_CONFIG_COUNT')).toBe(true);
    expect(isDeniedEnvName('SOME_UNLISTED_SECRET')).toBe(true);
    expect(isDeniedEnvName('PATH')).toBe(false);
    expect(isDeniedEnvName('NEUMAR_MODEL_KEY')).toBe(false);
  });

  it('refuses a worker environment that carries an unapproved variable', () => {
    const prepared = prepareUnprivilegedWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: BRANCH,
      baseSha: BASE,
      sandboxDir: SANDBOX_ROOT,
      baseEnv: { PATH: '/usr/bin', GIT_CONFIG_COUNT: '1' },
    });
    expect(prepared.ok).toBe(true);
    expect(prepared.context?.env.GIT_CONFIG_COUNT).toBeUndefined();

    const tampered = assertWorkerEnvironment({
      ...prepared.context?.env,
      GIT_CONFIG_COUNT: '1',
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.violations).toContainEqual({
      rule: 'worker-env-not-allowed',
      name: 'GIT_CONFIG_COUNT',
    });
  });

  it('refuses a sandbox inside the host home or outside the temp root', () => {
    expect(assertIsolatedSandbox(SANDBOX_ROOT).ok).toBe(true);
    expect(
      assertIsolatedSandbox(path.join(os.homedir(), 'sandbox')),
    ).toMatchObject({ ok: false, reason: 'sandbox-inside-home' });
    expect(
      assertIsolatedSandbox('/definitely-not-tmp/x', '/tmp'),
    ).toMatchObject({ ok: false, reason: 'sandbox-outside-temp' });
    expect(
      assertIsolatedSandbox(
        path.join(SANDBOX_ROOT, 'repo'),
        os.tmpdir(),
        path.join(SANDBOX_ROOT, 'repo'),
      ),
    ).toMatchObject({ ok: false, reason: 'sandbox-inside-repo' });
  });

  it('resolves symlinks before judging the sandbox location', () => {
    const outside = path.join(SANDBOX_ROOT, 'outside');
    const repo = path.join(SANDBOX_ROOT, 'repo-checkout');
    mkdirSync(outside, { recursive: true });
    mkdirSync(repo, { recursive: true });
    const intoHome = path.join(SANDBOX_ROOT, 'link-to-home');
    const intoRepo = path.join(SANDBOX_ROOT, 'link-to-repo');
    const outOfTemp = path.join(SANDBOX_ROOT, 'link-to-root');
    symlinkSync(os.homedir(), intoHome);
    symlinkSync(repo, intoRepo);
    symlinkSync(path.parse(SANDBOX_ROOT).root, outOfTemp);

    expect(assertIsolatedSandbox(path.join(intoHome, 'x'))).toMatchObject({
      ok: false,
      reason: 'sandbox-inside-home',
    });
    expect(
      assertIsolatedSandbox(path.join(intoRepo, 'x'), os.tmpdir(), repo),
    ).toMatchObject({ ok: false, reason: 'sandbox-inside-repo' });
    expect(
      assertIsolatedSandbox(path.join(outOfTemp, 'x'), SANDBOX_ROOT),
    ).toMatchObject({ ok: false, reason: 'sandbox-outside-temp' });

    const prepared = prepareUnprivilegedWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: BRANCH,
      baseSha: BASE,
      sandboxDir: path.join(intoHome, 'x'),
    });
    expect(prepared.ok).toBe(false);
    expect(prepared.context).toBeNull();
  });

  it('prepares only a read-only worker with a clean environment', () => {
    const prepared = prepareUnprivilegedWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: BRANCH,
      baseSha: BASE,
      sandboxDir: SANDBOX_ROOT,
      baseEnv: { PATH: '/usr/bin', GH_TOKEN: 'secret' },
      repoAccess: 'read-only',
    });
    expect(prepared.ok).toBe(true);
    expect(prepared.context?.env.GH_TOKEN).toBeUndefined();
    expect(prepared.context?.repoAccess).toBe('read-only');

    const writable = prepareUnprivilegedWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: BRANCH,
      baseSha: BASE,
      sandboxDir: SANDBOX_ROOT,
      repoAccess: 'write',
    });
    expect(writable.ok).toBe(false);
    expect(writable.violations.map((entry) => entry.rule)).toContain(
      'worker-repo-access',
    );

    const wrongBranch = prepareUnprivilegedWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: 'agent/issue-363-other',
      baseSha: BASE,
      sandboxDir: SANDBOX_ROOT,
    });
    expect(wrongBranch.ok).toBe(false);
    expect(wrongBranch.violations.map((entry) => entry.rule)).toContain(
      'worker-branch',
    );
  });

  it('finalizes only a report that matches the worker context', () => {
    const prepared = prepareUnprivilegedWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: BRANCH,
      baseSha: BASE,
      sandboxDir: SANDBOX_ROOT,
    });
    expect(prepared.context).not.toBeNull();
    const report = validReport();
    const result = finalizeWorkerReport({
      context: prepared.context,
      report,
      changedFiles: ['scripts/bug-publisher/publisher.mjs'],
    });
    expect(result.ok).toBe(true);

    const drifted = finalizeWorkerReport({
      context: prepared.context,
      report: validReport({ headSha: REMOTE }),
      changedFiles: ['scripts/bug-publisher/publisher.mjs'],
    });
    expect(drifted.ok).toBe(false);

    const wrongFiles = finalizeWorkerReport({
      context: prepared.context,
      report,
      changedFiles: ['src/other.ts'],
    });
    expect(wrongFiles.ok).toBe(false);
  });

  it('returns a clean abort report with no patch', () => {
    const report = abortWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: BRANCH,
      baseSha: BASE,
      reason: 'could-not-reproduce',
      sanitization: validReport().sanitization,
    });
    expect(report.reproduced).toBe(false);
    expect(report.aborted).toBe(true);
    expect(report.abortReason).toBe('could-not-reproduce');
    expect(report.headSha).toBeNull();
  });
});

describe('safe push', () => {
  it('accepts a fast-forward of bot commits', () => {
    const result = assertSafePush({
      baseSha: BASE,
      localHead: HEAD,
      remoteHead: REMOTE,
      commitsAhead: [{ sha: HEAD, authorLogin: BOT }],
      botLogin: BOT,
      isAncestor: () => true,
    });
    expect(result).toMatchObject({ ok: true, needsPush: true });
  });

  it('refuses a human commit on the owned branch', () => {
    const result = assertSafePush({
      baseSha: BASE,
      localHead: HEAD,
      remoteHead: null,
      commitsAhead: [{ sha: HEAD, authorLogin: 'bravew' }],
      botLogin: BOT,
      isAncestor: () => true,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'human-commit',
      author: 'bravew',
    });
  });

  it('refuses a force-push over the remote head', () => {
    const result = assertSafePush({
      baseSha: BASE,
      localHead: HEAD,
      remoteHead: REMOTE,
      commitsAhead: [{ sha: HEAD, authorLogin: BOT }],
      botLogin: BOT,
      isAncestor: () => false,
    });
    expect(result).toMatchObject({ ok: false, reason: 'non-fast-forward' });
  });

  it('requires commit evidence that ends at the local head', () => {
    expect(
      assertSafePush({
        baseSha: BASE,
        localHead: HEAD,
        commitsAhead: [],
        botLogin: BOT,
      }),
    ).toMatchObject({ ok: false, reason: 'commit-list-missing' });
    expect(
      assertSafePush({
        baseSha: BASE,
        localHead: HEAD,
        commitsAhead: [{ sha: REMOTE, authorLogin: BOT }],
        botLogin: BOT,
      }),
    ).toMatchObject({ ok: false, reason: 'commit-list-head-mismatch' });
    expect(
      assertSafePush({
        baseSha: BASE,
        localHead: BASE,
        commitsAhead: [{ sha: BASE, authorLogin: BOT }],
        botLogin: BOT,
      }),
    ).toMatchObject({ ok: false, reason: 'no-commits' });
  });
});

describe('publisher', () => {
  it('pushes only the owned branch and opens exactly one PR', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git }),
    );

    expect(result).toMatchObject({
      published: true,
      action: 'created',
      pushed: true,
      branch: BRANCH,
      targetBase: TARGET_BASE,
      prNumber: 100,
    });
    expect(git.push).toHaveBeenCalledTimes(1);
    expect(git.push).toHaveBeenCalledWith({
      branch: BRANCH,
      head: HEAD,
      identity: appIdentity(),
    });
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
    expect(github.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ head: BRANCH, base: TARGET_BASE }),
    );
    expect(github.prs).toHaveLength(1);
    expect(github.prs[0]?.body).toContain('Closes #362');
  });

  it('restarts after a push without pushing again and updates the one PR', async () => {
    const github = createGithubFake([
      {
        number: 77,
        headRefName: BRANCH,
        state: 'open',
        body: 'Closes #362',
        url: 'https://example.test/pull/77',
      },
    ]);
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        remoteHead: HEAD,
      }),
    );

    expect(result).toMatchObject({
      published: true,
      action: 'updated',
      pushed: false,
      prNumber: 77,
    });
    expect(git.push).not.toHaveBeenCalled();
    expect(github.createPullRequest).not.toHaveBeenCalled();
    expect(github.updatePullRequest).toHaveBeenCalledTimes(1);
    expect(github.prs).toHaveLength(1);
  });

  it('recovers from a lost PR-creation response without a duplicate', async () => {
    const github = createGithubFake([], { failCreateAfterWrite: true });
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git }),
    );

    expect(result).toMatchObject({
      published: true,
      action: 'recovered',
      prNumber: 100,
    });
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
    expect(github.prs).toHaveLength(1);
  });

  it('opens exactly one PR across repeated publish attempts', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const first = await publishBugFix(
      validOptions({ github: github.github, git: git.git }),
    );
    const second = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        remoteHead: HEAD,
      }),
    );

    expect(first.action).toBe('created');
    expect(second.action).toBe('updated');
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
    expect(github.updatePullRequest).toHaveBeenCalledTimes(1);
    expect(github.prs).toHaveLength(1);
  });

  it('aborts cleanly when the bug could not be reproduced', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const report = abortWorker({
      issue: ISSUE,
      claim: { runId: 'run-1', epoch: 7 },
      branch: BRANCH,
      baseSha: BASE,
      reason: 'could-not-reproduce',
      sanitization: validReport().sanitization,
    });
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git, report }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'not-reproduced',
    });
    expect(git.push).not.toHaveBeenCalled();
    expect(github.createPullRequest).not.toHaveBeenCalled();
    expect(github.updatePullRequest).not.toHaveBeenCalled();
  });

  it('refuses to push when a human commit is on the branch', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        commitsAhead: [{ sha: HEAD, authorLogin: 'bravew' }],
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'human-commit',
    });
    expect(git.push).not.toHaveBeenCalled();
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('stops when a human commit appears between preflight and push', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const readBranchState = vi
      .fn()
      .mockResolvedValueOnce({
        remoteHead: null,
        commitsAhead: [{ sha: HEAD, authorLogin: BOT }],
      })
      .mockResolvedValueOnce({
        remoteHead: null,
        commitsAhead: [{ sha: HEAD, authorLogin: 'bravew' }],
      });
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        readBranchState,
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'human-commit',
    });
    expect(git.push).not.toHaveBeenCalled();
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('stops before opening a PR when the branch changes after the push', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const readBranchState = vi
      .fn()
      .mockResolvedValueOnce({
        remoteHead: null,
        commitsAhead: [{ sha: HEAD, authorLogin: BOT }],
      })
      .mockResolvedValueOnce({
        remoteHead: null,
        commitsAhead: [{ sha: HEAD, authorLogin: BOT }],
      })
      .mockResolvedValueOnce({
        remoteHead: REMOTE,
        commitsAhead: [{ sha: HEAD, authorLogin: BOT }],
      });
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        readBranchState,
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'branch-changed-after-push',
    });
    expect(git.push).toHaveBeenCalledTimes(1);
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('refuses a non-fast-forward push', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        remoteHead: REMOTE,
        isAncestor: () => false,
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'non-fast-forward',
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('refuses a policy violation before pushing', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const changedFiles = ['.github/workflows/ci.yml'];
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        changedFiles,
        report: validReport({ changedFiles }),
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'policy-violation',
    });
    expect(git.push).not.toHaveBeenCalled();
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('refuses to push every denied path and frozen-debt growth', async () => {
    const cases: Array<{
      changedFiles: string[];
      extra?: Partial<PublishOptions>;
    }> = [
      { changedFiles: ['.github/workflows/ci.yml'] },
      { changedFiles: ['.github/PULL_REQUEST_TEMPLATE.md'] },
      { changedFiles: ['src-tauri/capabilities/default.json'] },
      { changedFiles: ['src-tauri/tauri.conf.json'] },
      { changedFiles: ['scripts/release.sh'] },
      { changedFiles: ['scripts/publish.sh'] },
      { changedFiles: ['scripts/r2-upload.sh'] },
      { changedFiles: ['scripts/build.sh'] },
      { changedFiles: ['scripts/sign-dev-macos.sh'] },
      { changedFiles: ['branding/default/icon.svg'] },
      { changedFiles: ['AGENTS.md'] },
      { changedFiles: ['LESSONS.md'] },
      { changedFiles: ['CLAUDE.md'] },
      { changedFiles: ['package.json'] },
      { changedFiles: ['pnpm-lock.yaml'] },
      {
        changedFiles: ['scripts/component-size-allowlist.json'],
        extra: {
          componentSizeBase: {
            'src/components/A.tsx': { current: 400, target: 350 },
          },
          componentSizeHead: {
            'src/components/A.tsx': { current: 401, target: 350 },
          },
        },
      },
      {
        changedFiles: ['scripts/lint-warning-baseline.json'],
        extra: {
          warningBaselineBase: {
            version: 2,
            warnings: {},
            suppressions: {},
            exceptions: [],
          },
          warningBaselineHead: {
            version: 2,
            warnings: { 'src/a.tsx': { 'react(refs)': 1 } },
            suppressions: {},
            exceptions: [],
          },
        },
      },
    ];

    for (const testCase of cases) {
      const github = createGithubFake();
      const git = createGitFake();
      const result = await publishBugFix(
        validOptions({
          github: github.github,
          git: git.git,
          changedFiles: testCase.changedFiles,
          report: validReport({ changedFiles: testCase.changedFiles }),
          ...testCase.extra,
        }),
      );

      expect(result, testCase.changedFiles.join(',')).toMatchObject({
        published: false,
        reason: 'policy-violation',
      });
      expect(git.push, testCase.changedFiles.join(',')).not.toHaveBeenCalled();
      expect(
        github.createPullRequest,
        testCase.changedFiles.join(','),
      ).not.toHaveBeenCalled();
    }
  });

  it('refuses an invalid verification report before pushing', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const report = validReport({
      regression: { ...validReport().regression, failsOnBase: false },
    });
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git, report }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'report-invalid',
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('refuses a PR that would close the epic instead of the bug', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const report = validReport({
      prTemplate: { ...validReport().prTemplate, closesIssue: 358 },
    });
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git, report }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'report-invalid',
    });
    expect(result.violations?.map((entry) => entry.rule)).toContain(
      'pr-closes-issue',
    );
    expect(git.push).not.toHaveBeenCalled();
  });

  it('refuses a non-App identity', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        identity: { ...appIdentity(), kind: 'github-token' },
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'publisher-identity-invalid',
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('refuses a target base that is not an epic branch', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        targetBase: 'main',
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'target-base-protected',
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('refuses a duplicate PR from another branch before pushing', async () => {
    const github = createGithubFake([
      {
        number: 9,
        headRefName: 'agent/issue-999-other',
        state: 'open',
        body: 'Closes #362',
      },
    ]);
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'duplicate-pr-exists',
      numbers: [9],
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('refuses more than one open PR on the owned branch', async () => {
    const github = createGithubFake([
      { number: 1, headRefName: BRANCH, state: 'open', body: '' },
      { number: 2, headRefName: BRANCH, state: 'open', body: '' },
    ]);
    const git = createGitFake();
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'multiple-owned-prs',
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('stops when the issue is closed, held, or reclassified', async () => {
    const cases: Array<[FreshIssue, string]> = [
      [{ ...approvedIssue(), state: 'closed' }, 'issue-closed'],
      [
        {
          ...approvedIssue(),
          labels: ['bug', 'agent:bug-approved', 'agent:hold'],
        },
        'held',
      ],
      [
        {
          ...approvedIssue(),
          labels: ['bug', 'agent:bug-approved', 'needs-decision'],
        },
        'needs-decision',
      ],
      [
        {
          ...approvedIssue(),
          labels: ['bug', 'agent:bug-approved', 'security'],
        },
        'security-sensitive',
      ],
      [
        {
          ...approvedIssue(),
          labels: ['bug', 'agent:bug-approved', 'enhancement'],
        },
        'reclassified-feature',
      ],
      [{ ...approvedIssue(), labels: ['agent:bug-approved'] }, 'not-a-bug'],
    ];

    for (const [issue, reason] of cases) {
      const github = createGithubFake();
      const git = createGitFake();
      const result = await publishBugFix(
        validOptions({
          github: github.github,
          git: git.git,
          readFreshIssue: async () => issue,
        }),
      );
      expect(result, reason).toMatchObject({
        published: false,
        reason,
      });
      expect(git.push, reason).not.toHaveBeenCalled();
    }
  });

  it('stops when approval is withdrawn between claim and push', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const readFreshIssue = vi
      .fn()
      .mockResolvedValueOnce(approvedIssue())
      .mockResolvedValueOnce({
        ...approvedIssue(),
        labels: ['bug'],
      });
    const result = await publishBugFix(
      validOptions({
        github: github.github,
        git: git.git,
        readFreshIssue,
        resolveApproval: (issue: { labels: string[] }) =>
          issue.labels.includes('agent:bug-approved')
            ? { status: 'approved', actor: 'bravew' }
            : { status: 'absent' },
      }),
    );

    expect(result).toMatchObject({
      published: false,
      reason: 'approval-absent',
    });
    expect(git.push).not.toHaveBeenCalled();
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('stops when the issue is held between claim and push', async () => {
    const github = createGithubFake();
    const git = createGitFake();
    const readFreshIssue = vi
      .fn()
      .mockResolvedValueOnce(approvedIssue())
      .mockResolvedValueOnce({
        ...approvedIssue(),
        labels: ['bug', 'agent:bug-approved', 'agent:hold'],
      });
    const result = await publishBugFix(
      validOptions({ github: github.github, git: git.git, readFreshIssue }),
    );

    expect(result).toMatchObject({ published: false, reason: 'held' });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('stops when the kill switch disables the claim before push', async () => {
    for (const reason of ['disabled', 'lease-expired', 'claim-superseded']) {
      const github = createGithubFake();
      const git = createGitFake();
      const verifyClaim = vi
        .fn()
        .mockReturnValueOnce({ ok: true, reason: 'ok' })
        .mockReturnValueOnce({ ok: false, reason });
      const result = await publishBugFix(
        validOptions({ github: github.github, git: git.git, verifyClaim }),
      );

      expect(result, reason).toMatchObject({
        published: false,
        reason: `claim-${reason}`,
      });
      expect(git.push, reason).not.toHaveBeenCalled();
      expect(github.createPullRequest, reason).not.toHaveBeenCalled();
    }
  });
});

describe('GitHub App installation token helper', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const env = {
    PUBLISHER_APP_ID: '12345',
    PUBLISHER_APP_PRIVATE_KEY: privateKey,
  };

  it('reads only the two App credentials from the supplied environment', () => {
    expect(loadPublisherAppCredentials(env)).toEqual({
      appId: '12345',
      privateKey,
    });
    expect(() => loadPublisherAppCredentials({})).toThrow(/PUBLISHER_APP_ID/);
    expect(() =>
      loadPublisherAppCredentials({
        PUBLISHER_APP_ID: 'not-a-number',
        PUBLISHER_APP_PRIVATE_KEY: privateKey,
      }),
    ).toThrow(/numeric App id/);
    expect(() =>
      loadPublisherAppCredentials({
        PUBLISHER_APP_ID: '12345',
        PUBLISHER_APP_PRIVATE_KEY: 'not a key',
      }),
    ).toThrow(/PEM private key/);
  });

  it('signs a short-lived RS256 App JWT', () => {
    const jwt = createAppJwt({
      appId: '12345',
      privateKey,
      now: 1_700_000_000,
    });
    const [header, payload, signature] = jwt.split('.');
    expect(
      JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    ).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    expect(claims.iss).toBe('12345');
    expect(claims.iat).toBe(1_700_000_000 - 60);
    expect(claims.exp).toBe(1_700_000_000 + 540);
    expect(signature.length).toBeGreaterThan(0);
  });

  it('exchanges the JWT for a least-privilege installation token', async () => {
    const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          token: 'test-installation-token',
          expires_at: '2026-11-24T13:00:00.000Z',
          permissions: {
            contents: 'write',
            pull_requests: 'write',
            issues: 'write',
            metadata: 'read',
          },
        }),
      };
    };
    const token = await createInstallationTokenFromEnv({
      installationId: 99,
      repository: 'bravew/Neumar',
      env,
      fetchImpl,
      now: 1_700_000_000,
    });

    expect(token).toEqual({
      token: 'test-installation-token',
      expiresAt: '2026-11-24T13:00:00.000Z',
      permissions: {
        contents: 'write',
        pull_requests: 'write',
        issues: 'write',
        metadata: 'read',
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/app/installations/99/access_tokens',
    );
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      repositories: ['Neumar'],
    });
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    expect(
      String((calls[0]?.init?.headers as Record<string, string>).Authorization),
    ).toMatch(/^Bearer /);
  });

  it('rejects an installation token with forbidden permissions', async () => {
    expect(
      assertAppTokenLeastPrivilege({
        contents: 'write',
        pull_requests: 'write',
        workflows: 'write',
      }).ok,
    ).toBe(false);
    expect(
      assertAppTokenLeastPrivilege({
        contents: 'read',
        pull_requests: 'write',
      }).ok,
    ).toBe(false);

    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        token: 'test-installation-token',
        permissions: {
          contents: 'write',
          pull_requests: 'write',
          administration: 'write',
        },
      }),
    });
    await expect(
      createInstallationTokenFromEnv({
        installationId: 99,
        repository: 'Neumar',
        env,
        fetchImpl,
      }),
    ).rejects.toThrow(/least-privilege/);
  });

  it('refuses to request a token that is not scoped to one repository', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    for (const repository of [undefined, '', 'a/b/c', '..', 'bad name']) {
      await expect(
        createInstallationTokenFromEnv({
          installationId: 99,
          repository: repository as string,
          env,
          fetchImpl,
        }),
      ).rejects.toThrow(/repository/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not log or return a token on a failed exchange', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'forbidden' }),
    });
    await expect(
      createInstallationTokenFromEnv({
        installationId: 99,
        repository: 'Neumar',
        env,
        fetchImpl,
      }),
    ).rejects.toThrow(/status 403/);
  });
});
