import { describe, expect, it } from 'vitest';

import {
  GATE_APP_ID,
  artifactBaseName,
  checkChecksums,
  decidePlan,
  evaluateCiGate,
  nextPointer,
  parsePointer,
  type CiVerdict,
  type Pointer,
} from '../../../scripts/lib/daily-preview.mjs';

/**
 * Decision logic for the daily desktop preview (#366). Each scenario named in the
 * issue maps to a case here: new commits, no change since last good, duplicate
 * scheduled run, failed/cancelled/missing CI Gate, and a missing or corrupted
 * artifact. Packaging failure is a workflow property, covered in
 * daily-preview-workflow.test.ts.
 */
const CANDIDATE = 'a'.repeat(40);
const LAST_GOOD = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

function gateRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'CI Gate',
    app: { id: GATE_APP_ID },
    head_sha: CANDIDATE,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-11-24T10:00:00Z',
    started_at: '2026-11-24T10:00:00Z',
    ...overrides,
  };
}

function payload(runs: unknown[], total = runs.length) {
  return { total_count: total, check_runs: runs };
}

const pass: CiVerdict = { ok: true };

describe('evaluateCiGate', () => {
  it('passes a completed success from the Actions app on the exact SHA', () => {
    expect(evaluateCiGate(payload([gateRun()]), CANDIDATE)).toEqual({
      ok: true,
    });
  });

  it('reports missing when no gate exists on that SHA', () => {
    const verdict = evaluateCiGate(payload([]), CANDIDATE);
    expect(verdict).toMatchObject({ ok: false, state: 'missing' });
  });

  it('does not accept a gate that belongs to another commit', () => {
    const verdict = evaluateCiGate(
      payload([gateRun({ head_sha: OTHER })]),
      CANDIDATE,
    );
    expect(verdict).toMatchObject({ ok: false, state: 'missing' });
  });

  it('does not accept a same-named check from another app', () => {
    const verdict = evaluateCiGate(
      payload([gateRun({ app: { id: 1 } })]),
      CANDIDATE,
    );
    expect(verdict).toMatchObject({ ok: false, state: 'missing' });
  });

  it('does not accept a differently named check', () => {
    const verdict = evaluateCiGate(
      payload([gateRun({ name: 'Test' })]),
      CANDIDATE,
    );
    expect(verdict).toMatchObject({ ok: false, state: 'missing' });
  });

  it.each(['in_progress', 'queued', 'pending'])(
    'reports %s as pending, not success',
    (status) => {
      const verdict = evaluateCiGate(
        payload([gateRun({ status, conclusion: null })]),
        CANDIDATE,
      );
      expect(verdict).toMatchObject({ ok: false, state: 'pending' });
    },
  );

  it.each(['failure', 'cancelled', 'skipped', 'timed_out', 'neutral'])(
    'rejects a completed gate that concluded %s',
    (conclusion) => {
      const verdict = evaluateCiGate(
        payload([gateRun({ conclusion })]),
        CANDIDATE,
      );
      expect(verdict).toMatchObject({ ok: false, state: 'failed' });
    },
  );

  it('lets the newest run decide: an old success does not hide a newer cancel', () => {
    const verdict = evaluateCiGate(
      payload([
        gateRun({
          id: 1,
          created_at: '2026-11-24T09:00:00Z',
          started_at: '2026-11-24T09:00:00Z',
        }),
        gateRun({
          id: 2,
          created_at: '2026-11-24T10:00:00Z',
          started_at: '2026-11-24T10:00:00Z',
          conclusion: 'cancelled',
        }),
      ]),
      CANDIDATE,
    );
    expect(verdict).toMatchObject({ ok: false, state: 'failed' });
  });

  it('lets a newer success replace an older failure (a re-run)', () => {
    const verdict = evaluateCiGate(
      payload([
        gateRun({
          id: 1,
          created_at: '2026-11-24T09:00:00Z',
          started_at: '2026-11-24T09:00:00Z',
          conclusion: 'failure',
        }),
        gateRun({
          id: 2,
          created_at: '2026-11-24T10:00:00Z',
          started_at: '2026-11-24T10:00:00Z',
        }),
      ]),
      CANDIDATE,
    );
    expect(verdict).toEqual({ ok: true });
  });

  it('treats a newer queued run as pending even though it has no started_at', () => {
    // started_at is null while a run is queued. Ordering by it sorts the empty
    // string before every real timestamp, which would let the older success decide.
    const verdict = evaluateCiGate(
      payload([
        gateRun({
          id: 1,
          created_at: '2026-11-24T09:00:00Z',
          started_at: '2026-11-24T09:00:00Z',
        }),
        gateRun({
          id: 2,
          created_at: '2026-11-24T10:00:00Z',
          started_at: null,
          status: 'queued',
          conclusion: null,
        }),
      ]),
      CANDIDATE,
    );
    expect(verdict).toMatchObject({ ok: false, state: 'pending' });
  });

  it('orders by id when runs carry no created_at (the documented check-run shape)', () => {
    // The check-run API has no run-level created_at. A queued rerun has no
    // started_at either, so id is the only creation-order key.
    const run = (overrides: Record<string, unknown>) => {
      const { created_at: _created, ...base } = gateRun();
      return { ...base, ...overrides };
    };
    const older = run({
      id: 100,
      started_at: '2026-11-24T09:00:00Z',
      completed_at: '2026-11-24T09:05:00Z',
    });
    const queued = run({
      id: 200,
      started_at: null,
      status: 'queued',
      conclusion: null,
    });
    for (const runs of [
      [older, queued],
      [queued, older],
    ]) {
      expect(evaluateCiGate(payload(runs), CANDIDATE)).toMatchObject({
        ok: false,
        state: 'pending',
      });
    }
  });

  it('treats a gate run without a numeric id as unknown order', () => {
    const { id: _id, ...noId } = gateRun();
    expect(evaluateCiGate(payload([noId]), CANDIDATE)).toMatchObject({
      ok: false,
      state: 'unknown',
    });
  });

  it('treats a truncated response as unknown', () => {
    const verdict = evaluateCiGate(payload([gateRun()], 3), CANDIDATE);
    expect(verdict).toMatchObject({ ok: false, state: 'unknown' });
  });

  it.each([null, undefined, 'oops', {}, { check_runs: [] }])(
    'treats a malformed response (%j) as unknown',
    (bad) => {
      expect(evaluateCiGate(bad, CANDIDATE)).toMatchObject({
        ok: false,
        state: 'unknown',
      });
    },
  );

  it('rejects a candidate that is not a full SHA', () => {
    expect(() => evaluateCiGate(payload([]), 'main')).toThrow(/40-character/);
  });
});

describe('decidePlan', () => {
  it('builds when main moved and the gate passed', () => {
    expect(
      decidePlan({
        candidateSha: CANDIDATE,
        lastGoodSha: LAST_GOOD,
        ci: pass,
      }),
    ).toEqual({
      action: 'build',
      reason: 'new verified commits',
      range: `${LAST_GOOD}..${CANDIDATE}`,
    });
  });

  it('builds the first time, with an explicit initial range', () => {
    const plan = decidePlan({
      candidateSha: CANDIDATE,
      lastGoodSha: null,
      ci: pass,
    });
    expect(plan.action).toBe('build');
    expect(plan.range).toBe(`initial..${CANDIDATE}`);
  });

  it('records no-change without needing any CI evidence', () => {
    const plan = decidePlan({
      candidateSha: CANDIDATE,
      lastGoodSha: CANDIDATE,
      ci: undefined,
    });
    expect(plan.action).toBe('no-change');
  });

  it('treats a duplicate scheduled run after an advance as no-change', () => {
    const first = decidePlan({
      candidateSha: CANDIDATE,
      lastGoodSha: LAST_GOOD,
      ci: pass,
    });
    expect(first.action).toBe('build');
    const pointer = nextPointer({
      current: pointerAt(LAST_GOOD),
      expectedPrevious: LAST_GOOD,
      candidateSha: CANDIDATE,
      verified: true,
      now: '2026-11-24T20:30:00Z',
      runUrl: 'https://example.test/run/1',
      artifact: artifactBaseName({ date: '2026-11-24', sha: CANDIDATE }),
    });
    const second = decidePlan({
      candidateSha: CANDIDATE,
      lastGoodSha: pointer.sha,
      ci: undefined,
    });
    expect(second.action).toBe('no-change');
  });

  it.each([
    ['missing', evaluateCiGate(payload([]), CANDIDATE)],
    [
      'pending',
      evaluateCiGate(
        payload([gateRun({ status: 'in_progress', conclusion: null })]),
        CANDIDATE,
      ),
    ],
    [
      'failed',
      evaluateCiGate(
        payload([gateRun({ conclusion: 'cancelled' })]),
        CANDIDATE,
      ),
    ],
    ['unknown', evaluateCiGate(null, CANDIDATE)],
  ])('aborts when the gate is %s', (state, ci) => {
    const plan = decidePlan({
      candidateSha: CANDIDATE,
      lastGoodSha: LAST_GOOD,
      ci,
    });
    expect(plan.action).toBe('abort');
    expect(plan.reason).toContain(`ci-${state}`);
  });

  it('aborts when there is no CI evidence at all', () => {
    const plan = decidePlan({
      candidateSha: CANDIDATE,
      lastGoodSha: LAST_GOOD,
      ci: undefined,
    });
    expect(plan.action).toBe('abort');
  });

  it('refuses a malformed last-good SHA instead of treating it as empty', () => {
    expect(() =>
      decidePlan({ candidateSha: CANDIDATE, lastGoodSha: 'oops', ci: pass }),
    ).toThrow(/last-good sha/);
  });
});

function pointerAt(sha: string): Pointer {
  return {
    schema: 1,
    sha,
    advancedAt: '2026-11-23T20:30:00Z',
    runUrl: 'https://example.test/run/0',
    artifact: '2026-11-23-bbbbbbb',
  };
}

describe('nextPointer', () => {
  const base = {
    expectedPrevious: LAST_GOOD,
    candidateSha: CANDIDATE,
    now: '2026-11-24T20:30:00Z',
    runUrl: 'https://example.test/run/1',
    artifact: '2026-11-24-aaaaaaa',
  };

  it('advances after a verified build', () => {
    const next = nextPointer({
      ...base,
      current: pointerAt(LAST_GOOD),
      verified: true,
    });
    expect(next.sha).toBe(CANDIDATE);
  });

  it('refuses to advance an unverified build', () => {
    expect(() =>
      nextPointer({
        ...base,
        current: pointerAt(LAST_GOOD),
        verified: false,
      }),
    ).toThrow(/not verified/);
  });

  it('refuses when the pointer moved since the plan read it', () => {
    expect(() =>
      nextPointer({
        ...base,
        current: pointerAt(OTHER),
        verified: true,
      }),
    ).toThrow(/pointer moved/);
  });

  it('is idempotent when the pointer already holds the candidate', () => {
    const current = pointerAt(CANDIDATE);
    expect(nextPointer({ ...base, current, verified: true })).toBe(current);
  });

  it('bootstraps from no pointer when none was expected', () => {
    const next = nextPointer({
      ...base,
      current: null,
      expectedPrevious: null,
      verified: true,
    });
    expect(next.sha).toBe(CANDIDATE);
  });

  it('refuses a bootstrap when a pointer appeared meanwhile', () => {
    expect(() =>
      nextPointer({
        ...base,
        current: pointerAt(OTHER),
        expectedPrevious: null,
        verified: true,
      }),
    ).toThrow(/pointer moved/);
  });
});

describe('parsePointer', () => {
  const valid = JSON.stringify(pointerAt(LAST_GOOD));

  it('round-trips a valid pointer', () => {
    expect(parsePointer(valid).sha).toBe(LAST_GOOD);
  });

  it.each([
    ['invalid JSON', '{not json'],
    [
      'an unknown schema',
      JSON.stringify({ ...pointerAt(LAST_GOOD), schema: 2 }),
    ],
    ['a short sha', JSON.stringify({ ...pointerAt(LAST_GOOD), sha: 'abc123' })],
    [
      'a missing artifact',
      JSON.stringify({ ...pointerAt(LAST_GOOD), artifact: '' }),
    ],
  ])('rejects %s rather than reading it as "no pointer"', (_label, text) => {
    expect(() => parsePointer(text)).toThrow();
  });
});

describe('artifactBaseName', () => {
  it('is unique per day and per commit', () => {
    const a = artifactBaseName({ date: '2026-11-24', sha: CANDIDATE });
    const nextDay = artifactBaseName({ date: '2026-11-25', sha: CANDIDATE });
    const otherSha = artifactBaseName({ date: '2026-11-24', sha: OTHER });
    expect(a).toBe('2026-11-24-aaaaaaa');
    expect(new Set([a, nextDay, otherSha]).size).toBe(3);
  });

  it('rejects a malformed date', () => {
    expect(() =>
      artifactBaseName({ date: '24/11/2026', sha: CANDIDATE }),
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe('checkChecksums', () => {
  const hash1 = '1'.repeat(64);
  const hash2 = '2'.repeat(64);
  const sums = `${hash1}  neumar-preview.dmg\n${hash2}  preview-manifest.json\n`;
  const actual = {
    'neumar-preview.dmg': hash1,
    'preview-manifest.json': hash2,
  };

  it('passes when every listed file matches and nothing else is present', () => {
    expect(checkChecksums(sums, actual)).toEqual({ ok: true, problems: [] });
  });

  it('flags a corrupted file', () => {
    const result = checkChecksums(sums, {
      ...actual,
      'neumar-preview.dmg': '9'.repeat(64),
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['checksum mismatch: neumar-preview.dmg']);
  });

  it('flags a missing file', () => {
    const result = checkChecksums(sums, {
      'preview-manifest.json': hash2,
    });
    expect(result.problems).toEqual(['missing file: neumar-preview.dmg']);
  });

  it('flags a file that SHA256SUMS does not list', () => {
    const result = checkChecksums(sums, { ...actual, 'extra.bin': hash1 });
    expect(result.problems).toEqual(['unlisted file: extra.bin']);
  });

  it('rejects an empty listing', () => {
    expect(checkChecksums('', {}).ok).toBe(false);
  });

  it('rejects a malformed listing', () => {
    expect(checkChecksums('not a checksum line\n', actual).ok).toBe(false);
  });
});
