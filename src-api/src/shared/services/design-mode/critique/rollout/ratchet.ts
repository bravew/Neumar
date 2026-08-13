import { getDatabase } from '@/shared/db';

import { nextCritiqueRolloutPhase } from './resolver';
import type { CritiqueRolloutPhase } from './types';

export interface CritiqueRatchetSnapshot {
  current: CritiqueRolloutPhase;
  recent: {
    runsLast24h: number;
    runsLast7d: number;
    conformanceViolationsLast24h: number;
    degradedRunsLast24h: number;
    degradedRunsLast7d: number;
  };
}

export function getCritiqueRatchetSnapshot(current: CritiqueRolloutPhase) {
  const db = getDatabase();
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent24h = readCritiqueMetricCounts(since24h, db);
  const recent7d = readCritiqueMetricCounts(since7d, db);
  return {
    current,
    recent: {
      runsLast24h: recent24h.runs,
      runsLast7d: recent7d.runs,
      conformanceViolationsLast24h: recent24h.violations,
      degradedRunsLast24h: recent24h.degradedRuns,
      degradedRunsLast7d: recent7d.degradedRuns,
    },
  } satisfies CritiqueRatchetSnapshot;
}

export function canPromoteCritique(snapshot: CritiqueRatchetSnapshot): {
  ok: boolean;
  reason?: string;
} {
  const next = nextCritiqueRolloutPhase(snapshot.current);
  if (next === snapshot.current) return { ok: false, reason: 'already-ga' };
  if (snapshot.current === 'M0') return { ok: true };
  if (snapshot.recent.conformanceViolationsLast24h > 0) {
    return { ok: false, reason: 'recent-conformance-violations' };
  }
  if (snapshot.current === 'M1' && snapshot.recent.runsLast24h < 5) {
    return { ok: false, reason: 'needs-5-runs-24h' };
  }
  if (snapshot.current === 'M2') {
    if (snapshot.recent.runsLast24h < 25) {
      return { ok: false, reason: 'needs-25-runs-24h' };
    }
    if (
      degradedShare(
        snapshot.recent.degradedRunsLast24h,
        snapshot.recent.runsLast24h,
      ) >= 0.1
    ) {
      return { ok: false, reason: 'degraded-share-too-high' };
    }
  }
  if (snapshot.current === 'M3') {
    if (snapshot.recent.runsLast7d < 100) {
      return { ok: false, reason: 'needs-100-runs-7d' };
    }
    if (
      degradedShare(
        snapshot.recent.degradedRunsLast7d,
        snapshot.recent.runsLast7d,
      ) >= 0.05
    ) {
      return { ok: false, reason: 'degraded-share-too-high' };
    }
  }
  return { ok: true };
}

function readCritiqueMetricCounts(
  since: string,
  db: ReturnType<typeof getDatabase>,
) {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS runs,
        SUM(CASE WHEN conformance_ok = 0 THEN 1 ELSE 0 END) AS violations,
        SUM(CASE WHEN degraded_panelist_count > 0 OR outcome = 'degraded' THEN 1 ELSE 0 END) AS degradedRuns
       FROM design_critique_metrics
       WHERE started_at >= ?`,
    )
    .get(since) as {
    runs: number;
    violations: number | null;
    degradedRuns: number | null;
  };
  return {
    runs: row.runs,
    violations: row.violations ?? 0,
    degradedRuns: row.degradedRuns ?? 0,
  };
}

function degradedShare(degradedRuns: number, runs: number) {
  if (runs === 0) return 0;
  return degradedRuns / runs;
}
