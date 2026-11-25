import { afterAll, describe, expect, it, vi } from 'vitest';

import type {
  PublisherGit,
  PublisherGithub,
  PullRequestInfo,
} from '../../../scripts/bug-publisher/index.mjs';
import {
  checkEpicReadiness,
  checkMergeSerialization,
  digestBrief,
  evaluateSliceScope,
  publishFeatureSlice,
  REQUIRED_EPIC_FILES,
  startFeatureSliceWorker,
  verifySliceApproval,
  type ApprovalInput,
  type EpicReadinessOptions,
  type PublishSliceOptions,
  type ReviewRecord,
  type SliceReport,
} from '../../../scripts/feature-slice/index.mjs';
import {
  AGGREGATE_CHECK,
  GITHUB_ACTIONS_APP_ID,
  REQUIRED_JOBS,
} from '../../../scripts/verify-pr-gate.mjs';

// @vitest-environment node
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Contract coverage for #365's feature-slice adapter.
 *
 * Every boundary is injected: git, GitHub reads and writes, the brief and
 * approval reader, and the clock. The tests drive the real entry points
 * (`startFeatureSliceWorker`, `publishFeatureSlice`, `checkEpicReadiness`), so a
 * check that only works in an inner helper cannot pass. No test runs git or gh,
 * reads a credential, or touches the host home.
 */

const EPIC_ISSUE = 900;
const SLICE_ISSUE = 901;
const EPIC_BRANCH = 'epic/900-saved-filters';
const BRANCH = 'agent/issue-901-filter-storage';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const BOT = 'neumar-publisher[bot]';
const REPO = 'bravew/Neumar';
const T0 = '2026-11-24T10:00:00Z';
const T1 = '2026-11-24T11:00:00Z';

const S1_OWNED = [
  'src-api/src/app/api/filters.ts',
  'src-api/test/unit/filters.test.ts',
];

function briefText(
  options: { owned?: string; shared?: string; note?: string } = {},
): string {
  const owned = options.owned ?? S1_OWNED.join(', ');
  const shared = options.shared ?? 'src-api/src/http-daemon.ts';
  return `# Example: saved search filters${options.note ?? ''}

Epic branch: ${EPIC_BRANCH}

## User outcome

A user can save a task search as a named filter and reopen it from the sidebar.

## Non-goals

- Sharing filters between users.

## Accountable owner

@bravew

## Acceptance criteria

- [http-route] \`POST /filters\` stores a filter and \`GET /filters\` returns it.

## Platform, branding and i18n

- User-facing text: yes
- Locales covered: en, zh, es, fr, hi, pt.

## Security and boundaries

- No outbound requests.

## Slices

### S1: filter storage API

- Owned files: ${owned}
- Shared files: ${shared}
- Depends on: none

### S2: sidebar UI

- Owned files: src/components/sidebar/SavedFilters.tsx
- Shared files: src/config/locale/messages/en/filters.ts
- Depends on: S1
`;
}

function approval(text: string, id = 1, at = T0) {
  return {
    id,
    authorLogin: 'bravew',
    authorAssociation: 'OWNER',
    authorType: 'User',
    createdAt: at,
    updatedAt: at,
    body: `Brief-Approval: sha256=${digestBrief(text)} epic=${EPIC_BRANCH} slices=S1`,
  };
}

function withdrawal(text: string, id = 2, at = T1) {
  return {
    ...approval(text, id, at),
    body: `Brief-Approval-Withdrawn: sha256=${digestBrief(text)}`,
  };
}

interface World {
  brief: string;
  comments: ApprovalInput['comments'];
  briefLabels: string[];
  sliceLabels: string[];
  sliceState: string;
  throwOnApprovalRead: boolean;
  approvalReads: number;
  /** Runs on the nth approval read, before it returns. */
  onApprovalRead?: (n: number) => void;
  log: string[];
}

function makeWorld(text = briefText()): World {
  return {
    brief: text,
    comments: [approval(text)],
    briefLabels: ['enhancement'],
    sliceLabels: [],
    sliceState: 'open',
    throwOnApprovalRead: false,
    approvalReads: 0,
    log: [],
  };
}

function readers(world: World) {
  return {
    sliceIssue: SLICE_ISSUE,
    readSliceIssue: async () => {
      world.log.push('read-slice-issue');
      return {
        number: SLICE_ISSUE,
        state: world.sliceState,
        labels: [...world.sliceLabels],
      };
    },
    readApprovalInput: async (): Promise<ApprovalInput> => {
      world.approvalReads += 1;
      world.log.push('read-approval');
      world.onApprovalRead?.(world.approvalReads);
      if (world.throwOnApprovalRead) throw new Error('GitHub 502');
      return {
        readComplete: true,
        issue: {
          state: 'open',
          labels: [...world.briefLabels],
          authorLogin: 'reporter',
        },
        briefText: world.brief,
        comments: world.comments.map((comment) => ({ ...comment })),
      };
    },
  };
}

function claimFor(text = briefText()) {
  return { digest: digestBrief(text), epicBranch: EPIC_BRANCH, slice: 'S1' };
}

const S1_CHANGED = [...S1_OWNED, 'src-api/src/http-daemon.ts'];

function report(overrides: Partial<SliceReport> = {}): SliceReport {
  const text = briefText();
  return {
    version: 1,
    issue: SLICE_ISSUE,
    sliceId: 'S1',
    digest: digestBrief(text),
    branch: BRANCH,
    baseSha: BASE,
    headSha: HEAD,
    changedFiles: S1_CHANGED,
    checks: [
      'pnpm validate',
      'pnpm --filter neumar-api lint',
      'pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit',
    ].map((command) => ({
      name: command,
      status: 'passed',
      command,
      evidence: 'exit 0',
    })),
    callerEvidence: {
      surface: 'http-route',
      testPath: 'src-api/test/unit/filters.test.ts',
      command: 'pnpm test:api test/unit/filters.test.ts',
      passesOnHead: true,
      headSha: HEAD,
    },
    userVisibleEvidence: 'GET /filters output after restart, attached.',
    prTemplate: {
      title: 'feat(filters): store saved filters',
      exactHeadSha: HEAD,
      nodeVersion: 'v22.20.0',
      pnpmVersion: '10.15.0',
      intent: 'Persist a named filter and return it after restart.',
      affectedContracts: 'Filters route and its db operations.',
      verificationSummary: 'Route test passes on this head.',
      unverified: [],
      attribution: {
        accountableContributor: 'bravew',
        authoringTool: 'Claude Code',
        sessionReference: 'opaque-session-1',
      },
      corrective: 'not applicable',
      closesIssue: SLICE_ISSUE,
    },
    ...overrides,
  };
}

function fakeGit() {
  return { push: vi.fn<PublisherGit['push']>(async () => undefined) };
}

function fakeGithub(existing: PullRequestInfo[] = []) {
  return {
    listOpenPullRequests: vi.fn<PublisherGithub['listOpenPullRequests']>(
      async () => existing,
    ),
    createPullRequest: vi.fn<PublisherGithub['createPullRequest']>(
      async () => ({}),
    ),
    updatePullRequest: vi.fn<PublisherGithub['updatePullRequest']>(
      async () => ({}),
    ),
  };
}

function publishOptions(
  world: World,
  overrides: Omit<Partial<PublishSliceOptions>, 'git' | 'github'> = {},
): PublishSliceOptions & {
  git: ReturnType<typeof fakeGit>;
  github: ReturnType<typeof fakeGithub>;
} {
  const git = fakeGit();
  const github = fakeGithub();
  // After the push lands, a re-read of the branch and the PR list must agree.
  git.push.mockImplementation(async () => {
    world.log.push('push');
  });
  github.createPullRequest.mockImplementation(async () => {
    world.log.push('create-pr');
    github.listOpenPullRequests.mockImplementation(async () => [
      {
        number: 77,
        headRefName: BRANCH,
        headRepository: REPO,
        state: 'open',
        url: 'https://example.invalid/pull/77',
      },
    ]);
    return {};
  });
  return {
    ...readers(world),
    sliceId: 'S1',
    claim: claimFor(),
    branch: BRANCH,
    repository: REPO,
    baseSha: BASE,
    localHead: HEAD,
    remoteHead: null,
    commitsAhead: [{ sha: HEAD, authorLogin: BOT, parentSha: BASE }],
    botLogin: BOT,
    isAncestor: () => true,
    report: report(),
    changedFiles: S1_CHANGED,
    identity: {
      kind: 'github-app-installation',
      permissions: {
        contents: 'write',
        pull_requests: 'write',
        issues: 'write',
        metadata: 'read',
      },
      branchScope: [BRANCH],
    },
    git,
    github,
    ...overrides,
  };
}

describe('slice scope', () => {
  it('accepts owned files and explicitly scheduled shared files', () => {
    const result = evaluateSliceScope({
      owned: S1_OWNED,
      shared: ['src-api/src/http-daemon.ts'],
      changedFiles: S1_CHANGED,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('in-scope');
  });

  it('covers a directory entry and nothing outside it', () => {
    const base = { owned: ['src/components/filters'], shared: [] };
    expect(
      evaluateSliceScope({
        ...base,
        changedFiles: ['src/components/filters/List.tsx'],
      }).ok,
    ).toBe(true);
    expect(
      evaluateSliceScope({
        ...base,
        changedFiles: ['src/components/filters-other/List.tsx'],
      }).ok,
    ).toBe(false);
  });

  it('fails a rename whose previous path leaves the slice', () => {
    const result = evaluateSliceScope({
      owned: S1_OWNED,
      shared: [],
      changedFiles: [
        { path: S1_OWNED[0], previousPath: 'src-api/src/app/api/tasks.ts' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain('out-of-scope');
  });

  it('refuses a glob in a declared list', () => {
    const result = evaluateSliceScope({
      owned: ['src-api/src/app/api/*.ts'],
      shared: [],
      changedFiles: ['src-api/src/app/api/filters.ts'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain(
      'scope-glob-unsupported',
    );
  });

  it('fails closed without a trusted changed-file list', () => {
    expect(
      evaluateSliceScope({ owned: S1_OWNED, shared: [], changedFiles: [] }).ok,
    ).toBe(false);
  });
});

describe('startFeatureSliceWorker', () => {
  const sandboxRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'neumar-365-')),
  );
  afterAll(() => {
    rmSync(sandboxRoot, { recursive: true, force: true });
  });
  const start = (world: World, overrides = {}) =>
    startFeatureSliceWorker({
      ...readers(world),
      sliceId: 'S1',
      lease: { runId: 'run-1', epoch: 3 },
      branch: BRANCH,
      baseSha: BASE,
      sandboxDir: path.join(sandboxRoot, 'sandbox'),
      tmpRoot: sandboxRoot,
      baseEnv: { PATH: '/usr/bin', GITHUB_TOKEN: 'must-not-pass' },
      ...overrides,
    });

  it('starts an approved slice with its scope and the epic target', async () => {
    const result = await start(makeWorld());
    expect(result.started).toBe(true);
    expect(result.targetBase).toBe(EPIC_BRANCH);
    expect(result.claim).toEqual(claimFor());
    expect(result.scope?.owned).toEqual(S1_OWNED);
    expect(result.scope?.shared).toEqual(['src-api/src/http-daemon.ts']);
    expect(result.context?.env.GITHUB_TOKEN).toBeUndefined();
  });

  it('returns to planning when approval was withdrawn before start', async () => {
    const world = makeWorld();
    world.comments.push(withdrawal(world.brief));
    const result = await start(world);
    expect(result.started).toBe(false);
    expect(result.outcome).toBe('return-to-planning');
    expect(result.context).toBeUndefined();
  });

  it('returns to planning when the brief changed after approval', async () => {
    const world = makeWorld();
    world.brief = briefText({ note: ' (revised)' });
    const result = await start(world);
    expect(result.started).toBe(false);
    expect(result.outcome).toBe('return-to-planning');
  });

  it('pauses, not proceeds, when the approval read fails', async () => {
    const world = makeWorld();
    world.throwOnApprovalRead = true;
    const result = await start(world);
    expect(result.started).toBe(false);
    expect(result.outcome).toBe('paused');
  });

  it('pauses on a held brief issue and on a held slice issue', async () => {
    const held = makeWorld();
    held.briefLabels = ['enhancement', 'agent:hold'];
    expect((await start(held)).outcome).toBe('paused');
    const sliceHeld = makeWorld();
    sliceHeld.sliceLabels = ['agent:hold'];
    expect((await start(sliceHeld)).outcome).toBe('paused');
  });

  it('refuses a slice issue that is the epic issue', async () => {
    const result = await start(makeWorld(), { sliceIssue: EPIC_ISSUE });
    expect(result.started).toBe(false);
  });
});

describe('publishFeatureSlice', () => {
  it('publishes to the approved epic branch and closes only the slice', async () => {
    const world = makeWorld();
    const options = publishOptions(world);
    const result = await publishFeatureSlice(options);

    expect(result).toMatchObject({
      published: true,
      action: 'created',
      pushed: true,
      targetBase: EPIC_BRANCH,
      closes: SLICE_ISSUE,
    });
    const created = options.github.createPullRequest.mock.calls[0][0];
    expect(created.base).toBe(EPIC_BRANCH);
    expect(created.base).not.toBe('main');
    expect(created.body).toContain(`Closes #${SLICE_ISSUE}`);
    expect(created.body).not.toContain(`#${EPIC_ISSUE}`);
  });

  it('reads the approval last before the push and before the PR write', async () => {
    const world = makeWorld();
    await publishFeatureSlice(publishOptions(world));
    const at = (name: string) => world.log.indexOf(name);
    expect(world.log[at('push') - 1]).toBe('read-approval');
    expect(world.log[at('create-pr') - 1]).toBe('read-approval');
  });

  describe('scope', () => {
    it('fails closed on an out-of-scope edit and writes nothing', async () => {
      const world = makeWorld();
      const files = [...S1_CHANGED, 'src/components/sidebar/Other.tsx'];
      const options = publishOptions(world, {
        changedFiles: files,
        report: report({ changedFiles: files }),
      });
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.outcome).toBe('paused-out-of-scope');
      expect(result.reason).toBe('scope-violation');
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          rule: 'out-of-scope',
          path: 'src/components/sidebar/Other.tsx',
        }),
      );
      expect(options.git.push).not.toHaveBeenCalled();
      expect(options.github.createPullRequest).not.toHaveBeenCalled();
    });

    it.each([
      'package.json',
      'pnpm-lock.yaml',
      'src/config/locale/messages/en/filters.ts',
      'packages/video-ir/src/timeline-schema.ts',
      'src-api/src/shared/mcp/video-edit-server.ts',
    ])('fails closed on the unscheduled shared file %s', async (shared) => {
      const world = makeWorld();
      const files = [...S1_CHANGED, shared];
      const options = publishOptions(world, {
        changedFiles: files,
        report: report({ changedFiles: files }),
      });
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.outcome).toBe('paused-out-of-scope');
      expect(result.violations).toContainEqual(
        expect.objectContaining({ rule: 'unscheduled-shared-file' }),
      );
      expect(options.git.push).not.toHaveBeenCalled();
    });

    it('allows a manifest only when the brief schedules that exact file', async () => {
      const text = briefText({
        shared: 'src-api/src/http-daemon.ts, src-api/package.json',
      });
      const world = makeWorld(text);
      const files = [...S1_CHANGED, 'src-api/package.json'];
      const result = await publishFeatureSlice(
        publishOptions(world, {
          claim: claimFor(text),
          changedFiles: files,
          report: report({ digest: digestBrief(text), changedFiles: files }),
        }),
      );
      expect(result.published).toBe(true);
    });

    it('keeps the #362 hard deny-list over a brief that owns a denied path', async () => {
      const text = briefText({ owned: '.github/workflows/ci.yml, AGENTS.md' });
      const world = makeWorld(text);
      const files = ['.github/workflows/ci.yml', 'AGENTS.md'];
      const options = publishOptions(world, {
        claim: claimFor(text),
        changedFiles: files,
        report: report({ digest: digestBrief(text), changedFiles: files }),
      });
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ rule: 'denied-path' }),
      );
      expect(options.git.push).not.toHaveBeenCalled();
    });

    it('keeps the ceiling rule when the brief schedules the allowlist', async () => {
      const text = briefText({
        shared:
          'src-api/src/http-daemon.ts, scripts/component-size-allowlist.json',
      });
      const world = makeWorld(text);
      const files = [...S1_CHANGED, 'scripts/component-size-allowlist.json'];
      const result = await publishFeatureSlice(
        publishOptions(world, {
          claim: claimFor(text),
          changedFiles: files,
          report: report({ digest: digestBrief(text), changedFiles: files }),
          componentSizeBase: { 'src/components/A.tsx': { current: 100 } },
          componentSizeHead: { 'src/components/A.tsx': { current: 120 } },
        }),
      );
      expect(result.published).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ rule: 'allowlist-ceiling-increase' }),
      );
    });

    it('refuses a report whose file list differs from the trusted diff', async () => {
      const world = makeWorld();
      const result = await publishFeatureSlice(
        publishOptions(world, {
          report: report({ changedFiles: [S1_OWNED[0]] }),
        }),
      );
      expect(result.published).toBe(false);
      expect(result.reason).toBe('report-invalid');
    });
  });

  describe('brief revision and approval (TOCTOU)', () => {
    it('pauses before push when the brief changes after the first check', async () => {
      const world = makeWorld();
      const options = publishOptions(world);
      // Read 1 is the preflight; read 2 is the last read before the push.
      world.onApprovalRead = (n) => {
        if (n === 2) world.brief = briefText({ note: ' (edited)' });
      };
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.outcome).toBe('return-to-planning');
      expect(world.approvalReads).toBe(2);
      expect(options.git.push).not.toHaveBeenCalled();
      expect(options.github.createPullRequest).not.toHaveBeenCalled();
    });

    it('pauses before push when approval is withdrawn after the first check', async () => {
      const world = makeWorld();
      const options = publishOptions(world);
      world.onApprovalRead = (n) => {
        if (n === 2) world.comments.push(withdrawal(world.brief));
      };
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.outcome).toBe('return-to-planning');
      expect(options.git.push).not.toHaveBeenCalled();
    });

    it('pauses when the approval cannot be re-read before the push', async () => {
      const world = makeWorld();
      const options = publishOptions(world);
      world.onApprovalRead = (n) => {
        if (n === 2) world.throwOnApprovalRead = true;
      };
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.outcome).toBe('paused');
      expect(options.git.push).not.toHaveBeenCalled();
    });

    it('halts before the PR write when the brief changes after the push', async () => {
      const world = makeWorld();
      const options = publishOptions(world);
      // Read 3 is the last read before the PR write.
      world.onApprovalRead = (n) => {
        if (n === 3) world.comments.push(withdrawal(world.brief));
      };
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.outcome).toBe('return-to-planning');
      expect(result.pushed).toBe(true);
      expect(options.github.createPullRequest).not.toHaveBeenCalled();
    });

    it('refuses when approval was withdrawn before publishing began', async () => {
      const world = makeWorld();
      world.comments.push(withdrawal(world.brief));
      const options = publishOptions(world);
      const result = await publishFeatureSlice(options);

      expect(result.outcome).toBe('return-to-planning');
      expect(options.git.push).not.toHaveBeenCalled();
    });

    it('verifySliceApproval names the changed revision', async () => {
      const world = makeWorld();
      world.brief = briefText({ note: ' (edited)' });
      const result = await verifySliceApproval({
        ...readers(world),
        claim: claimFor(),
      });
      expect(result).toMatchObject({
        ok: false,
        outcome: 'return-to-planning',
      });
    });
  });

  describe('target and closing keyword', () => {
    it('refuses a main target', async () => {
      const world = makeWorld();
      const options = publishOptions(world, { targetBase: 'main' });
      const result = await publishFeatureSlice(options);

      expect(result).toMatchObject({
        published: false,
        outcome: 'refused',
        reason: 'target-base-protected',
      });
      expect(options.git.push).not.toHaveBeenCalled();
      expect(options.github.createPullRequest).not.toHaveBeenCalled();
    });

    it('refuses an approval that names main as its epic branch', async () => {
      const world = makeWorld();
      const result = await publishFeatureSlice(
        publishOptions(world, { claim: { ...claimFor(), epicBranch: 'main' } }),
      );
      expect(result.reason).toBe('target-base-protected');
    });

    it('refuses an epic branch the maintainer did not approve', async () => {
      const world = makeWorld();
      const result = await publishFeatureSlice(
        publishOptions(world, { targetBase: 'epic/1-something-else' }),
      );
      expect(result.reason).toBe('target-base-not-approved-epic');
    });

    it.each([
      ['Closes #900', 'pr-closes-epic'],
      ['fixes bravew/Neumar#900', 'pr-closes-epic'],
      [
        'Resolves https://github.com/bravew/Neumar/issues/900',
        'pr-closes-epic',
      ],
      ['Closes #123', 'pr-closes-wrong-issue'],
    ])('refuses a body that says "%s"', async (text, reason) => {
      const world = makeWorld();
      const base = report();
      const options = publishOptions(world, {
        report: report({
          prTemplate: {
            ...base.prTemplate,
            intent: `Part of the epic. ${text}.`,
          },
        }),
      });
      const result = await publishFeatureSlice(options);

      expect(result.published).toBe(false);
      expect(result.reason).toBe(reason);
      expect(options.git.push).not.toHaveBeenCalled();
    });

    it('refuses a slice issue that is the epic issue', async () => {
      const world = makeWorld();
      const result = await publishFeatureSlice(
        publishOptions(world, {
          sliceIssue: EPIC_ISSUE,
          branch: 'agent/issue-900-epic',
        }),
      );
      expect(result.published).toBe(false);
    });

    it('refuses when another open PR already closes the slice issue', async () => {
      const world = makeWorld();
      const options = publishOptions(world);
      options.github.listOpenPullRequests.mockResolvedValue([
        {
          number: 5,
          headRefName: 'someone-else',
          headRepository: 'fork/Neumar',
          state: 'open',
          body: `Closes #${SLICE_ISSUE}`,
        },
      ]);
      const result = await publishFeatureSlice(options);
      expect(result.reason).toBe('duplicate-pr-exists');
      expect(options.git.push).not.toHaveBeenCalled();
    });

    it('refuses a commit not authored by the publisher', async () => {
      const world = makeWorld();
      const options = publishOptions(world, {
        commitsAhead: [{ sha: HEAD, authorLogin: 'a-human', parentSha: BASE }],
      });
      const result = await publishFeatureSlice(options);
      expect(result.reason).toBe('human-commit');
      expect(options.git.push).not.toHaveBeenCalled();
    });
  });
});

describe('checkMergeSerialization', () => {
  const slices = [
    { id: 'S1', shared: ['package.json'], depends: [] },
    { id: 'S2', shared: ['package.json'], depends: [] },
    { id: 'S3', shared: ['package.json'], depends: ['S1'] },
  ];

  it('blocks two unordered slices that edit the same shared file', () => {
    const result = checkMergeSerialization({
      slices,
      pending: [
        { sliceId: 'S1', changedFiles: ['package.json'] },
        { sliceId: 'S2', changedFiles: ['package.json'] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('blocked-until-serialized');
    expect(result.blockers).toContainEqual({
      rule: 'unserialized-shared-file',
      path: 'package.json',
      slices: ['S1', 'S2'],
    });
  });

  it('allows slices that a dependency orders', () => {
    const result = checkMergeSerialization({
      slices,
      pending: [
        { sliceId: 'S1', changedFiles: ['package.json'] },
        { sliceId: 'S3', changedFiles: ['package.json'] },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('blocks a shared-file edit the slice never scheduled', () => {
    const result = checkMergeSerialization({
      slices,
      pending: [{ sliceId: 'S1', changedFiles: ['pnpm-lock.yaml'] }],
    });
    expect(result.blockers).toContainEqual({
      rule: 'unscheduled-shared-file',
      path: 'pnpm-lock.yaml',
      slices: ['S1'],
    });
  });

  it('blocks an unknown slice rather than ignoring it', () => {
    const result = checkMergeSerialization({
      slices,
      pending: [{ sliceId: 'S9', changedFiles: ['package.json'] }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('checkEpicReadiness', () => {
  const EPIC_HEAD = 'c'.repeat(40);
  const OLD_HEAD = 'd'.repeat(40);
  const NOW = '2026-11-25T12:00:00Z';

  function checksFor(head: string, overrides: Record<string, unknown> = {}) {
    return [...REQUIRED_JOBS, AGGREGATE_CHECK].map((name, index) => ({
      id: index + 1,
      name,
      head_sha: head,
      status: 'completed',
      conclusion: 'success',
      app: { id: GITHUB_ACTIONS_APP_ID },
      ...(overrides[name] as object | undefined),
    }));
  }

  const goodReview: ReviewRecord = {
    headSha: EPIC_HEAD,
    verdict: 'ready-for-human',
    reviewer: 'independent-reviewer',
    recordedAt: '2026-11-25T10:00:00Z',
    blockingFindings: 0,
  };

  function options(
    overrides: Partial<EpicReadinessOptions> = {},
  ): EpicReadinessOptions {
    return {
      epicBranch: EPIC_BRANCH,
      readEpicHead: async () => EPIC_HEAD,
      readGateInputs: async (head) => ({
        pr: { headRefOid: head },
        checks: checksFor(head),
        changedPaths: ['src/a.ts'],
      }),
      readReview: async () => goodReview,
      hasFileAtRef: async () => true,
      publisherLogins: [BOT, 'bravew'],
      now: NOW,
      ...overrides,
    };
  }

  const codes = (result: { reasons: Array<{ code: string }> }) =>
    result.reasons.map((reason) => reason.code);

  it('is ready only for a verified head with a same-SHA independent review', async () => {
    const result = await checkEpicReadiness(options());
    expect(result.ready).toBe(true);
    expect(result.head).toBe(EPIC_HEAD);
    expect(result.autoMerge).toBe(false);
    expect(result.nextStep).toContain('human');
  });

  it('refuses a head whose CI ran on an older SHA', async () => {
    const result = await checkEpicReadiness(
      options({
        readGateInputs: async (head) => ({
          pr: { headRefOid: head },
          checks: checksFor(OLD_HEAD),
          changedPaths: ['src/a.ts'],
        }),
      }),
    );
    expect(result.ready).toBe(false);
    expect(codes(result)).toContain('gate-stale-head');
  });

  it('refuses a head whose CI Gate is missing or red', async () => {
    const missing = await checkEpicReadiness(
      options({
        readGateInputs: async (head) => ({
          pr: { headRefOid: head },
          checks: checksFor(head).filter((c) => c.name !== AGGREGATE_CHECK),
          changedPaths: [],
        }),
      }),
    );
    expect(codes(missing)).toContain('gate-missing-check');
    const red = await checkEpicReadiness(
      options({
        readGateInputs: async (head) => ({
          pr: { headRefOid: head },
          checks: checksFor(head, {
            [AGGREGATE_CHECK]: { conclusion: 'failure' },
          }),
          changedPaths: [],
        }),
      }),
    );
    expect(red.ready).toBe(false);
  });

  it('refuses gate metadata for a different head than the epic tip', async () => {
    const result = await checkEpicReadiness(
      options({
        readGateInputs: async () => ({
          pr: { headRefOid: OLD_HEAD },
          checks: checksFor(OLD_HEAD),
          changedPaths: [],
        }),
      }),
    );
    expect(result.ready).toBe(false);
    expect(codes(result)).toContain('gate-head-moved');
  });

  it('refuses a review recorded for another SHA, or none at all', async () => {
    const stale = await checkEpicReadiness(
      options({
        readReview: async () => ({ ...goodReview, headSha: OLD_HEAD }),
      }),
    );
    expect(codes(stale)).toContain('review-stale-head');
    const none = await checkEpicReadiness(
      options({ readReview: async () => null }),
    );
    expect(codes(none)).toContain('review-missing');
  });

  it('refuses a review by the publisher, an old review, and an unready verdict', async () => {
    const own = await checkEpicReadiness(
      options({ readReview: async () => ({ ...goodReview, reviewer: BOT }) }),
    );
    expect(codes(own)).toContain('review-not-independent');
    const old = await checkEpicReadiness(
      options({
        readReview: async () => ({
          ...goodReview,
          recordedAt: '2026-11-20T10:00:00Z',
        }),
      }),
    );
    expect(codes(old)).toContain('review-not-fresh');
    const changes = await checkEpicReadiness(
      options({
        readReview: async () => ({
          ...goodReview,
          verdict: 'request-changes',
          blockingFindings: 2,
        }),
      }),
    );
    expect(changes.ready).toBe(false);
  });

  it('refuses when the epic head moves during verification', async () => {
    const heads = [EPIC_HEAD, OLD_HEAD];
    const result = await checkEpicReadiness(
      options({ readEpicHead: async () => heads.shift() ?? OLD_HEAD }),
    );
    expect(result.ready).toBe(false);
    expect(codes(result)).toContain('epic-head-moved');
  });

  it('refuses main and treats a failed read as unknown, not ready', async () => {
    const main = await checkEpicReadiness(options({ epicBranch: 'main' }));
    expect(main.ready).toBe(false);
    expect(codes(main)).toContain('target-base-protected');
    const failed = await checkEpicReadiness(
      options({
        readReview: async () => {
          throw new Error('GitHub 502');
        },
      }),
    );
    expect(failed.ready).toBe(false);
    expect(codes(failed)).toContain('review-read-failed');
  });

  it('requires the epic branch to carry ci.yml and epic-close-issues.yml', async () => {
    const asked: string[] = [];
    const result = await checkEpicReadiness(
      options({
        hasFileAtRef: async (_ref, file) => {
          asked.push(file);
          return !file.endsWith('epic-close-issues.yml');
        },
      }),
    );
    expect(asked).toEqual([...REQUIRED_EPIC_FILES]);
    expect(codes(result)).toContain('epic-missing-workflow');
  });

  it('requires a Browser E2E run on the exact head when the epic changed UI', async () => {
    const missing = await checkEpicReadiness(
      options({ browserE2eRequired: true }),
    );
    expect(codes(missing)).toContain('browser-e2e-missing');
    const withE2e = (head: string) => [
      ...checksFor(EPIC_HEAD),
      {
        id: 50,
        name: 'Browser E2E',
        head_sha: head,
        status: 'completed',
        conclusion: 'success',
        app: { id: GITHUB_ACTIONS_APP_ID },
      },
    ];
    const ok = await checkEpicReadiness(
      options({
        browserE2eRequired: true,
        readGateInputs: async (head) => ({
          pr: { headRefOid: head },
          checks: withE2e(EPIC_HEAD),
          changedPaths: [],
        }),
      }),
    );
    expect(ok.ready).toBe(true);
    const stale = await checkEpicReadiness(
      options({
        browserE2eRequired: true,
        readGateInputs: async (head) => ({
          pr: { headRefOid: head },
          checks: withE2e(OLD_HEAD),
          changedPaths: [],
        }),
      }),
    );
    expect(codes(stale)).toContain('browser-e2e-stale-head');
  });
});
