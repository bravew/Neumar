import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveSetting } from '@/shared/db/operations';
import {
  canPromoteCritique,
  type CritiqueRatchetSnapshot,
} from '@/shared/services/design-mode/critique/rollout/ratchet';
import { resolveCritiqueRolloutPhase } from '@/shared/services/design-mode/critique/rollout/resolver';
import { getCritiqueRolloutSettings } from '@/shared/services/design-mode/critique/rollout/settings';

describe('critique rollout', () => {
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'neumar-critique-rollout-'));
    vi.stubEnv('HOME', home);
  });

  afterEach(async () => {
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves force-on, force-off, and M2 project-age gates', () => {
    expect(
      resolveCritiqueRolloutPhase(
        {
          rolloutPhase: 'M0',
          userOverride: 'on',
          promotedAt: { M0: '2026-05-01T00:00:00.000Z' },
        },
        { createdAt: '2026-05-15T00:00:00.000Z' },
      ),
    ).toBe('M1');
    expect(
      resolveCritiqueRolloutPhase(
        {
          rolloutPhase: 'M3',
          userOverride: 'off',
          promotedAt: {},
        },
        { createdAt: '2026-05-15T00:00:00.000Z' },
      ),
    ).toBe('M0');
    expect(
      resolveCritiqueRolloutPhase(
        {
          rolloutPhase: 'M2',
          userOverride: 'auto',
          promotedAt: { M2: '2026-05-15T00:00:00.000Z' },
        },
        { createdAt: '2026-05-14T00:00:00.000Z' },
      ),
    ).toBe('M1');
  });

  it('loads defaults and honors the env phase override', () => {
    vi.stubEnv('DESIGNMODE_CRITIQUE_ROLLOUT_PHASE', 'M2');

    expect(getCritiqueRolloutSettings()).toMatchObject({
      rolloutPhase: 'M2',
      userOverride: 'auto',
    });
  });

  it('falls back to M0 on invalid stored settings', () => {
    saveSetting(
      'designMode',
      JSON.stringify({ critique: { rolloutPhase: 'MX' } }),
    );

    expect(getCritiqueRolloutSettings()).toMatchObject({
      rolloutPhase: 'M0',
      userOverride: 'auto',
    });
  });

  it('enforces ratchet thresholds', () => {
    expect(canPromoteCritique(snapshot('M0', { runsLast24h: 0 }))).toEqual({
      ok: true,
    });
    expect(canPromoteCritique(snapshot('M1', { runsLast24h: 4 }))).toEqual({
      ok: false,
      reason: 'needs-5-runs-24h',
    });
    expect(canPromoteCritique(snapshot('M1', { runsLast24h: 5 }))).toEqual({
      ok: true,
    });
    expect(
      canPromoteCritique(
        snapshot('M2', { runsLast24h: 25, degradedRunsLast24h: 3 }),
      ),
    ).toEqual({ ok: false, reason: 'degraded-share-too-high' });
    expect(
      canPromoteCritique(
        snapshot('M3', { runsLast7d: 100, degradedRunsLast7d: 4 }),
      ),
    ).toEqual({ ok: true });
  });
});

function snapshot(
  current: CritiqueRatchetSnapshot['current'],
  recent: Partial<CritiqueRatchetSnapshot['recent']>,
): CritiqueRatchetSnapshot {
  return {
    current,
    recent: {
      runsLast24h: 0,
      runsLast7d: 0,
      conformanceViolationsLast24h: 0,
      degradedRunsLast24h: 0,
      degradedRunsLast7d: 0,
      ...recent,
    },
  };
}
