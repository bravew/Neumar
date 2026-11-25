import { afterEach, describe, expect, it } from 'vitest';

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Coverage for the nightly lessons review (#367).
 *
 * The pure helpers are tested directly. The collector is tested against an
 * in-memory source so every failed or truncated read can be forced. The CLI is
 * tested against a real throwaway git repository with a fake `gh` on PATH, so
 * the git parsing and the exit codes are exercised at the surface the workflow
 * uses.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../');
const LIB = path.join(REPO_ROOT, 'scripts', 'lib', 'nightly-lessons');
const CLI = path.join(REPO_ROOT, 'scripts', 'nightly-lessons.mjs');

type Evidence = {
  reviewDate: string;
  refs: string[];
  summary: string;
  ran: string;
  missed: string;
};
type Lesson = {
  key: string;
  title: string;
  seenDates: string[];
};
type Finding = {
  detector: string;
  commit: string;
  lessonPrefix: string | null;
  refs: string[];
  summary: string;
  ran: string;
  missed: string;
};
type Commit = {
  sha: string;
  subject: string;
  body: string;
  committedAt: string;
};
type Source = {
  isAncestor: (base: string, head: string) => Promise<boolean>;
  commits: (base: string, head: string) => Promise<Commit[]>;
  changedFiles: (sha: string) => Promise<string[]>;
  fileChange: (
    sha: string,
    file: string,
  ) => Promise<{ before: string | null; after: string | null }>;
  addedLines: (
    sha: string,
    pathspecs: string[],
  ) => Promise<{ file: string; line: number; text: string }[]>;
  pulls: (sha: string) => Promise<{ number: number }[]>;
  gate: (sha: string) => Promise<{
    total: number;
    runs: {
      name: string;
      appId: number | null;
      status: string;
      conclusion: string | null;
    }[];
  }>;
  issueReopens: (number: number) => Promise<{ createdAt: string }[]>;
};
type Collected = {
  complete: boolean;
  reasons: string[];
  range: { base: string; head: string; commits: number };
  commits: { sha: string; gate: string }[];
  findings: Finding[];
};
type Outcome = {
  text: string;
  changed: boolean;
  applied: unknown[];
  replays: unknown[];
  rejected: unknown[];
  candidates: Finding[];
  promotions: { title: string; days: number }[];
};

type LessonsFile = {
  parseCursor: (t: string) => { sha: string; date: string } | null;
  setCursor: (t: string, sha: string, date: string) => string;
  parseLessons: (t: string) => Lesson[];
  applyEvidence: (
    t: string,
    key: string,
    e: Evidence,
  ) => { text: string; changed: boolean };
  addLesson: (
    t: string,
    p: Evidence & { rule: string; section: string },
  ) => { text: string; changed: boolean };
  promotionCandidates: (t: string) => { days: number }[];
  validateLessonsFile: (t: string) => string[];
};
type EvidenceMod = {
  validateProposal: (p: unknown) => { ok: boolean; problems: string[] };
};
type CollectMod = {
  collectRange: (
    s: Source,
    r: { cursor: string; head: string },
  ) => Promise<Collected>;
};
type ReviewMod = {
  reviewRange: (a: {
    lessonsText: string;
    collected: Collected;
    reviewDate: string;
    extraProposals?: unknown[];
    catchUp?: boolean;
  }) => Outcome;
  renderReport: (a: {
    date: string;
    collected: Collected;
    outcome: Outcome;
    catchUp: boolean;
  }) => string;
};

async function load<T>(file: string): Promise<T> {
  return (await import(/* @vite-ignore */ path.join(LIB, file))) as T;
}

const lessonsFile = await load<LessonsFile>('lessons-file.mjs');
const evidenceMod = await load<EvidenceMod>('evidence.mjs');
const collectMod = await load<CollectMod>('collect.mjs');
const reviewMod = await load<ReviewMod>('review.mjs');

const SKIPPED = 'a check that skips your change is not validation';
const CEILING = 'never raise a threshold or allowlist ceiling';

const FIXTURE = `<!-- reviewed-through: aaaaaaaa (2026-10-13) -->
# Lessons from merged work

## Validation

**A check that skips your change is not validation. Run the closest check.**
- #176 repaired tests that #175 had broken.
- Seen 1x (2026-10-13).

**Never raise a threshold or allowlist ceiling to make a check pass.**
- dd346af1 raised three ceilings in one commit.
- Seen 1x (2026-10-13).

## Contracts

**After cancellation, wait for cleanup.**
- Epic #351's run-batch.ts:88 woke on an aborted signal.
- Seen 1x (2026-11-21).
`;

function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    reviewDate: '2026-11-24',
    refs: ['#400'],
    summary: 'A thing went wrong.',
    ran: 'A command ran.',
    missed: 'The check skipped it.',
    ...over,
  };
}

function lessonKey(text: string, prefix: string): string {
  const found = lessonsFile
    .parseLessons(text)
    .find((l) => l.key.startsWith(prefix));
  if (!found) throw new Error(`fixture has no lesson ${prefix}`);
  return found.key;
}

describe('LESSONS.md helpers', () => {
  it('reads and rewrites the cursor on line 1 only', () => {
    expect(lessonsFile.parseCursor(FIXTURE)).toEqual({
      sha: 'aaaaaaaa',
      date: '2026-10-13',
    });
    const moved = lessonsFile.setCursor(FIXTURE, 'bbbbbbbb', '2026-11-24');
    expect(moved.split('\n')[0]).toBe(
      '<!-- reviewed-through: bbbbbbbb (2026-11-24) -->',
    );
    expect(moved.split('\n').slice(1)).toEqual(FIXTURE.split('\n').slice(1));
    expect(() =>
      lessonsFile.setCursor('# no cursor\n', 'bbbbbbbb', '2026-11-24'),
    ).toThrow();
  });

  it('accepts the real LESSONS.md and keeps its 2026-11-21 entry', () => {
    const real = readFileSync(path.join(REPO_ROOT, 'LESSONS.md'), 'utf-8');
    expect(lessonsFile.validateLessonsFile(real)).toEqual([]);
    const cancellation = lessonsFile
      .parseLessons(real)
      .find((l) => l.key.startsWith('after cancellation'));
    expect(cancellation?.seenDates).toEqual(['2026-11-21']);
  });

  it('rejects a Seen line whose count disagrees with its dates', () => {
    const broken = FIXTURE.replace(
      'Seen 1x (2026-11-21)',
      'Seen 2x (2026-11-21)',
    );
    expect(lessonsFile.validateLessonsFile(broken).join('\n')).toMatch(
      /does not match/,
    );
  });

  it('writes the same evidence once, so replaying a range is a no-op', () => {
    const key = lessonKey(FIXTURE, SKIPPED);
    const first = lessonsFile.applyEvidence(FIXTURE, key, evidence());
    expect(first.changed).toBe(true);
    expect(first.text).toContain('Seen 2x (2026-10-13, 2026-11-24).');

    const replay = lessonsFile.applyEvidence(first.text, key, evidence());
    expect(replay.changed).toBe(false);
    expect(replay.text).toBe(first.text);

    // The same incident found a day later must not become a second review day.
    const nextDay = lessonsFile.applyEvidence(
      first.text,
      key,
      evidence({ reviewDate: '2026-11-25' }),
    );
    expect(nextDay.changed).toBe(false);
    expect(nextDay.text).toContain('Seen 2x (2026-10-13, 2026-11-24).');
  });

  it('counts three incidents on one UTC date as one review day', () => {
    const key = lessonKey(FIXTURE, SKIPPED);
    let text = FIXTURE;
    for (const ref of ['#401', '#402', '#403']) {
      text = lessonsFile.applyEvidence(
        text,
        key,
        evidence({ refs: [ref] }),
      ).text;
    }
    const lesson = lessonsFile.parseLessons(text).find((l) => l.key === key);
    expect(lesson?.seenDates).toEqual(['2026-10-13', '2026-11-24']);
    expect(lessonsFile.promotionCandidates(text)).toEqual([]);
    expect(lessonsFile.validateLessonsFile(text)).toEqual([]);
  });

  it('proposes promotion only after three separate UTC review days', () => {
    const key = lessonKey(FIXTURE, SKIPPED);
    let text = FIXTURE;
    text = lessonsFile.applyEvidence(
      text,
      key,
      evidence({ refs: ['#401'] }),
    ).text;
    expect(lessonsFile.promotionCandidates(text)).toEqual([]);
    text = lessonsFile.applyEvidence(
      text,
      key,
      evidence({ refs: ['#402'], reviewDate: '2026-11-26' }),
    ).text;
    expect(lessonsFile.promotionCandidates(text)).toEqual([
      expect.objectContaining({ days: 3 }),
    ]);
  });

  it('does not match #35 against an existing #351 reference', () => {
    const key = lessonKey(FIXTURE, 'after cancellation');
    const result = lessonsFile.applyEvidence(
      FIXTURE,
      key,
      evidence({ refs: ['#35'] }),
    );
    expect(result.changed).toBe(true);
  });

  it('adds a new lesson once at Seen 1x', () => {
    const proposal = {
      ...evidence({ refs: ['#410'] }),
      rule: 'Close the loop on every new rule.',
      section: 'Validation',
    };
    const first = lessonsFile.addLesson(FIXTURE, proposal);
    expect(first.changed).toBe(true);
    expect(first.text).toContain('Seen 1x (2026-11-24).');
    expect(lessonsFile.validateLessonsFile(first.text)).toEqual([]);
    expect(lessonsFile.addLesson(first.text, proposal).changed).toBe(false);
  });
});

describe('evidence validator', () => {
  it('accepts a PR, a commit, or a file and line with run and miss notes', () => {
    for (const ref of ['#12', 'c0926618', 'src/a/b.ts:88']) {
      const checked = evidenceMod.validateProposal({
        kind: 'increment',
        lessonKey: 'x',
        ...evidence({ refs: [ref] }),
      });
      expect(checked.problems).toEqual([]);
      expect(checked.ok).toBe(true);
    }
  });

  it('rejects missing evidence, bad refs, bad dates, and multi-line text', () => {
    const checked = evidenceMod.validateProposal({
      kind: 'increment',
      lessonKey: 'x',
      reviewDate: '2026-02-30',
      refs: ['see the thread'],
      summary: 'two\nlines',
      ran: '',
      missed: '   ',
    });
    expect(checked.ok).toBe(false);
    const text = checked.problems.join('\n');
    expect(text).toMatch(/real UTC date/);
    expect(text).toMatch(/not a PR, commit, or file:line/);
    expect(text).toMatch(/ran/);
    expect(text).toMatch(/missed/);
    expect(text).toMatch(/single line/);
  });

  it('rejects a proposal with no evidence references', () => {
    const checked = evidenceMod.validateProposal({
      kind: 'new',
      rule: 'A rule.',
      section: 'Validation',
      ...evidence({ refs: [] }),
    });
    expect(checked.ok).toBe(false);
  });
});

const HEAD = 'f'.repeat(40);
const BASE = 'a'.repeat(40);

function sha(n: number): string {
  // Distinct first 8 characters, because evidence cites the short sha.
  return `${String(n).padStart(8, '0')}${'a'.repeat(32)}`;
}

function fakeSource(
  over: Partial<Source> = {},
  commits: Commit[] = [],
): Source {
  return {
    isAncestor: async () => true,
    commits: async () => commits,
    changedFiles: async () => [],
    fileChange: async () => ({ before: null, after: null }),
    addedLines: async () => [],
    pulls: async () => [{ number: 1 }],
    gate: async () => ({
      total: 1,
      runs: [
        {
          name: 'CI Gate',
          appId: 15368,
          status: 'completed',
          conclusion: 'success',
        },
      ],
    }),
    issueReopens: async () => [],
    ...over,
  };
}

function commit(n: number, over: Partial<Commit> = {}): Commit {
  return {
    sha: sha(n),
    subject: `feat: change ${n} (#${100 + n})`,
    body: '',
    committedAt: '2026-11-20T10:00:00Z',
    ...over,
  };
}

describe('range collector', () => {
  it('reports a quiet day for an empty range', async () => {
    const result = await collectMod.collectRange(fakeSource(), {
      cursor: BASE,
      head: HEAD,
    });
    expect(result.complete).toBe(true);
    expect(result.range.commits).toBe(0);
    const outcome = reviewMod.reviewRange({
      lessonsText: FIXTURE,
      collected: result,
      reviewDate: '2026-11-24',
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.text).toBe(FIXTURE);
    expect(
      reviewMod.renderReport({
        date: '2026-11-24',
        collected: result,
        outcome,
        catchUp: false,
      }),
    ).toMatch(/Quiet day/);
  });

  it.each([
    [
      'a failed check-run read',
      { gate: async () => Promise.reject(new Error('HTTP 502')) },
      /check runs for 00000001: HTTP 502/,
    ],
    [
      'a failed pull request lookup',
      { pulls: async () => Promise.reject(new Error('HTTP 403')) },
      /pull requests for 00000001/,
    ],
    [
      'truncated check runs',
      {
        gate: async () => ({ total: 120, runs: [] }),
      },
      /truncated/,
    ],
    [
      'a cursor that is not an ancestor',
      { isAncestor: async () => false },
      /not an ancestor/,
    ],
    [
      'a failed commit list',
      { commits: async () => Promise.reject(new Error('git failed')) },
      /first-parent commit list/,
    ],
  ])(
    'is incomplete and proposes nothing after %s',
    async (_name, over, reason) => {
      const result = await collectMod.collectRange(
        fakeSource(over as Partial<Source>, [commit(1)]),
        { cursor: BASE, head: HEAD },
      );
      expect(result.complete).toBe(false);
      expect(result.reasons.join('\n')).toMatch(reason);
      expect(result.findings).toEqual([]);

      const outcome = reviewMod.reviewRange({
        lessonsText: FIXTURE,
        collected: result,
        reviewDate: '2026-11-24',
        catchUp: true,
      });
      expect(outcome.changed).toBe(false);
      expect(outcome.text).toBe(FIXTURE);
      expect(outcome.text.split('\n')[0]).toContain('aaaaaaaa');
    },
  );

  it('flags a missing, failed, or wrong-app CI Gate on a merged commit', async () => {
    const wrongApp = fakeSource(
      {
        gate: async () => ({
          total: 1,
          runs: [
            {
              name: 'CI Gate',
              appId: 99,
              status: 'completed',
              conclusion: 'success',
            },
          ],
        }),
      },
      [commit(1)],
    );
    const failed = fakeSource(
      {
        gate: async () => ({
          total: 1,
          runs: [
            {
              name: 'CI Gate',
              appId: 15368,
              status: 'completed',
              conclusion: 'cancelled',
            },
          ],
        }),
      },
      [commit(1)],
    );
    for (const [source, state] of [
      [wrongApp, 'missing'],
      [failed, 'cancelled'],
    ] as const) {
      const result = await collectMod.collectRange(source, {
        cursor: BASE,
        head: HEAD,
      });
      expect(result.complete).toBe(true);
      expect(result.commits[0].gate).toBe(state);
      expect(result.findings).toEqual([
        expect.objectContaining({ detector: 'ci-gate', refs: ['00000001'] }),
      ]);
    }
  });

  it('flags allowlist growth, baseline growth, and new suppressions', async () => {
    const allowlist = (current: number) =>
      `${JSON.stringify({ 'src/components/A.tsx': { current, target: 350 } }, null, 2)}\n`;
    const baseline = (count: number) =>
      JSON.stringify({
        warnings: { 'src/a.tsx': { 'react(refs)': count } },
        suppressions: {},
        exceptions: [],
      });
    const source = fakeSource(
      {
        changedFiles: async () => [
          'scripts/component-size-allowlist.json',
          'scripts/lint-warning-baseline.json',
          'src/components/A.tsx',
        ],
        fileChange: async (_sha, file) =>
          file.endsWith('allowlist.json')
            ? { before: allowlist(400), after: allowlist(500) }
            : { before: baseline(1), after: baseline(2) },
        addedLines: async () => [
          {
            file: 'src/components/A.tsx',
            line: 12,
            // Built in two parts so the warning baseline gate does not count this
            // fixture as a real suppression comment.
            text: `// ${'eslint'}-disable-next-line x`,
          },
          {
            file: 'src/__tests__/a.test.ts',
            line: 3,
            text: '// @ts-expect-error',
          },
        ],
      },
      [commit(1)],
    );
    const result = await collectMod.collectRange(source, {
      cursor: BASE,
      head: HEAD,
    });
    expect(result.findings.map((f) => f.detector).sort()).toEqual([
      'allowlist-growth',
      'baseline-growth',
      'new-suppression',
    ]);
    const suppression = result.findings.find(
      (f) => f.detector === 'new-suppression',
    );
    expect(suppression?.refs).toContain('src/components/A.tsx:12');
    expect(suppression?.summary).toMatch(/^1 new/);
  });

  it('flags reverts, fix-forward commits, and reopened issues', async () => {
    const source = fakeSource(
      {
        issueReopens: async (n) =>
          n === 77 ? [{ createdAt: '2026-11-21T00:00:00Z' }] : [],
      },
      [
        commit(1, { subject: 'feat: add thing (#101)', body: 'Closes #77' }),
        commit(2, { subject: 'fix: repair thing from #101 (#102)' }),
        commit(3, {
          subject: 'Revert "feat: add thing (#101)"',
          body: `This reverts commit ${sha(1)}.`,
        }),
      ],
    );
    const result = await collectMod.collectRange(source, {
      cursor: BASE,
      head: HEAD,
    });
    expect(result.findings.map((f) => f.detector).sort()).toEqual([
      'fix-forward',
      'reopened-issue',
      'revert',
    ]);
    // None of these name a lesson, so they stay candidates for a person.
    expect(result.findings.every((f) => f.lessonPrefix === null)).toBe(true);
  });
});

describe('review decisions', () => {
  async function gateFailure(): Promise<Collected> {
    const source = fakeSource(
      {
        gate: async () => ({ total: 0, runs: [] }),
        changedFiles: async () => ['scripts/component-size-allowlist.json'],
        fileChange: async () => ({
          before: '{"src/components/A.tsx":{"current":400,"target":350}}',
          after: '{"src/components/A.tsx":{"current":500,"target":350}}',
        }),
      },
      [commit(1), commit(2)],
    );
    return collectMod.collectRange(source, { cursor: BASE, head: HEAD });
  }

  it('writes evidence once and a replay of the same range changes nothing', async () => {
    const collected = await gateFailure();
    const first = reviewMod.reviewRange({
      lessonsText: FIXTURE,
      collected,
      reviewDate: '2026-11-24',
    });
    expect(first.changed).toBe(true);
    expect(first.text.split('\n')[0]).toBe(
      `<!-- reviewed-through: ${HEAD} (2026-11-24) -->`,
    );
    expect(lessonsFile.validateLessonsFile(first.text)).toEqual([]);
    const ceiling = lessonsFile
      .parseLessons(first.text)
      .find((l) => l.key.startsWith(CEILING));
    expect(ceiling?.seenDates).toEqual(['2026-10-13', '2026-11-24']);

    const replay = reviewMod.reviewRange({
      lessonsText: first.text,
      collected,
      reviewDate: '2026-11-25',
    });
    expect(replay.changed).toBe(false);
    expect(replay.text).toBe(first.text);
  });

  it('keeps the existing 2026-11-21 entry from being counted again', () => {
    const collected: Collected = {
      complete: true,
      reasons: [],
      range: { base: BASE, head: HEAD, commits: 1 },
      commits: [],
      findings: [],
    };
    const key = lessonKey(FIXTURE, 'after cancellation');
    const outcome = reviewMod.reviewRange({
      lessonsText: FIXTURE,
      collected,
      reviewDate: '2026-11-24',
      extraProposals: [
        {
          kind: 'increment',
          lessonKey: key,
          ...evidence({ refs: ['#351', 'run-batch.ts:88'] }),
        },
      ],
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.replays).toHaveLength(1);
    expect(outcome.text).toBe(FIXTURE);
  });

  it('catches up by moving only the cursor and writing no lesson', async () => {
    const collected = await gateFailure();
    expect(collected.findings.length).toBeGreaterThan(0);
    const outcome = reviewMod.reviewRange({
      lessonsText: FIXTURE,
      collected,
      reviewDate: '2026-11-24',
      catchUp: true,
    });
    expect(outcome.changed).toBe(true);
    expect(outcome.applied).toEqual([]);
    expect(outcome.candidates).toEqual(collected.findings);
    expect(outcome.text.split('\n').slice(1)).toEqual(
      FIXTURE.split('\n').slice(1),
    );
    expect(lessonsFile.parseCursor(outcome.text)).toEqual({
      sha: HEAD,
      date: '2026-11-24',
    });
  });

  it('does not treat creating the allowlist or baseline file as growth', async () => {
    const source = fakeSource(
      {
        changedFiles: async () => [
          'scripts/component-size-allowlist.json',
          'scripts/lint-warning-baseline.json',
        ],
        fileChange: async (_sha, file) => ({
          before: null,
          after: file.includes('allowlist')
            ? '{"src/components/A.tsx":{"current":500,"target":350}}'
            : '{"warnings":{"src/a.tsx":{"react(refs)":4}},"suppressions":{}}',
        }),
      },
      [commit(1)],
    );
    const result = await collectMod.collectRange(source, {
      cursor: BASE,
      head: HEAD,
    });
    expect(result.complete).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('rejects a bad explicit proposal instead of writing it', () => {
    const collected: Collected = {
      complete: true,
      reasons: [],
      range: { base: BASE, head: HEAD, commits: 1 },
      commits: [],
      findings: [],
    };
    const outcome = reviewMod.reviewRange({
      lessonsText: FIXTURE,
      collected,
      reviewDate: '2026-11-24',
      extraProposals: [
        { kind: 'new', rule: 'No evidence.', section: 'Validation' },
      ],
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.rejected).toHaveLength(1);
  });

  it('keeps untrusted commit text inside code spans in the report', async () => {
    const hostile = commit(1, {
      subject: 'Revert "x @someone `rm -rf` (#999)"\n# injected heading',
    });
    const collected = await collectMod.collectRange(fakeSource({}, [hostile]), {
      cursor: BASE,
      head: HEAD,
    });
    const outcome = reviewMod.reviewRange({
      lessonsText: FIXTURE,
      collected,
      reviewDate: '2026-11-24',
    });
    const report = reviewMod.renderReport({
      date: '2026-11-24',
      collected,
      outcome,
      catchUp: false,
    });
    expect(report).not.toMatch(/^# injected/m);
    expect(report).not.toMatch(/[^`]@someone/);
  });
});

describe('nightly-lessons CLI against a real git repository', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.invalid',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.invalid',
      },
    }).trim();
  }

  function makeRepo() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nightly-lessons-'));
    dirs.push(root);
    const repo = path.join(root, 'repo');
    mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    const allowlist = (n: number) =>
      `${JSON.stringify({ 'src/components/A.tsx': { current: n, target: 350 } }, null, 2)}\n`;
    writeFileSync(
      path.join(repo, 'scripts/component-size-allowlist.json'),
      allowlist(400),
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'chore: baseline (#1)');
    const base = git(repo, 'rev-parse', 'HEAD');

    writeFileSync(
      path.join(repo, 'scripts/component-size-allowlist.json'),
      allowlist(520),
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'feat: raise a ceiling (#2)');
    const raised = git(repo, 'rev-parse', 'HEAD');

    writeFileSync(
      path.join(repo, 'LESSONS.md'),
      FIXTURE.replace('aaaaaaaa', base.slice(0, 8)),
    );

    // A fake `gh` that answers the three read endpoints the collector uses.
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const gh = path.join(bin, 'gh');
    writeFileSync(
      gh,
      [
        '#!/bin/sh',
        'if [ -n "$FAKE_GH_FAIL" ]; then echo "HTTP 502" >&2; exit 1; fi',
        'case "$2" in',
        '  */pulls) echo \'[[{"number":2}]]\' ;;',
        '  */check-runs*) echo \'[{"total_count":0,"check_runs":[]}]\' ;;',
        "  */events*) echo '[[]]' ;;",
        '  *) echo "unexpected: $2" >&2; exit 1 ;;',
        'esac',
        '',
      ].join('\n'),
    );
    chmodSync(gh, 0o755);
    return { root, repo, bin, base, raised };
  }

  function runCli(
    ctx: ReturnType<typeof makeRepo>,
    extra: string[] = [],
    env: Record<string, string> = {},
  ) {
    return spawnSync(
      process.execPath,
      [
        CLI,
        '--repo',
        'owner/name',
        '--out',
        path.join(ctx.root, 'out'),
        '--date',
        '2026-11-24',
        ...extra,
      ],
      {
        cwd: ctx.repo,
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${ctx.bin}:${process.env.PATH}`, ...env },
      },
    );
  }

  it('writes evidence for a raised ceiling and a missing gate, then replays cleanly', () => {
    const ctx = makeRepo();
    const first = runCli(ctx, ['--apply']);
    expect(first.status, first.stderr).toBe(0);

    const after = readFileSync(path.join(ctx.repo, 'LESSONS.md'), 'utf-8');
    expect(lessonsFile.validateLessonsFile(after)).toEqual([]);
    expect(lessonsFile.parseCursor(after)).toEqual({
      sha: ctx.raised,
      date: '2026-11-24',
    });
    const seen = lessonsFile.parseLessons(after).map((l) => l.seenDates.join());
    expect(seen).toEqual([
      '2026-10-13,2026-11-24',
      '2026-10-13,2026-11-24',
      '2026-11-21',
    ]);
    const report = readFileSync(path.join(ctx.root, 'out/report.md'), 'utf-8');
    expect(report).toMatch(/missing 1/);

    // Replaying the same range from the same cursor writes nothing new.
    writeFileSync(
      path.join(ctx.repo, 'LESSONS.md'),
      after.replace(
        `${ctx.raised.slice(0, 8)} (2026-11-24)`,
        `${ctx.base.slice(0, 8)} (2026-10-13)`,
      ),
    );
    const second = runCli(ctx, ['--apply', '--date', '2026-11-25']);
    expect(second.status, second.stderr).toBe(0);
    const replayed = readFileSync(path.join(ctx.repo, 'LESSONS.md'), 'utf-8');
    expect(replayed.split('\n').slice(1)).toEqual(after.split('\n').slice(1));
  });

  it('exits 2, leaves LESSONS.md alone, and keeps the cursor when a read fails', () => {
    const ctx = makeRepo();
    const before = readFileSync(path.join(ctx.repo, 'LESSONS.md'), 'utf-8');
    const result = runCli(ctx, ['--apply', '--catch-up'], {
      FAKE_GH_FAIL: '1',
    });
    expect(result.status).toBe(2);
    expect(readFileSync(path.join(ctx.repo, 'LESSONS.md'), 'utf-8')).toBe(
      before,
    );
    const report = readFileSync(path.join(ctx.root, 'out/report.md'), 'utf-8');
    expect(report).toMatch(/Incomplete/);
  });

  it('catches up from the CLI: no lesson written, cursor at the head', () => {
    const ctx = makeRepo();
    const before = readFileSync(path.join(ctx.repo, 'LESSONS.md'), 'utf-8');
    const result = runCli(ctx, ['--apply', '--catch-up']);
    expect(result.status, result.stderr).toBe(0);
    const after = readFileSync(path.join(ctx.repo, 'LESSONS.md'), 'utf-8');
    expect(after.split('\n').slice(1)).toEqual(before.split('\n').slice(1));
    expect(lessonsFile.parseCursor(after)?.sha).toBe(ctx.raised);
    expect(readFileSync(path.join(ctx.root, 'out/report.md'), 'utf-8')).toMatch(
      /Catch-up run/,
    );
  });

  it('reports a quiet day when the cursor already equals the head', () => {
    const ctx = makeRepo();
    writeFileSync(
      path.join(ctx.repo, 'LESSONS.md'),
      FIXTURE.replace('aaaaaaaa', ctx.raised.slice(0, 8)),
    );
    const result = runCli(ctx, ['--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(ctx.root, 'out/report.md'), 'utf-8')).toMatch(
      /Quiet day/,
    );
  });
});
