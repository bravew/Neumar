import { runCritiqueConformance } from '../conformance/runner';
import { emitCritiqueEvent } from '../observability/events';
import { getCritiqueRatchetSnapshot, canPromoteCritique } from './ratchet';
import {
  nextCritiqueRolloutPhase,
  resolveCritiqueRolloutPhase,
} from './resolver';
import {
  getCritiqueRolloutSettings,
  updateCritiqueRolloutSettings,
} from './settings';
import type { CritiqueRolloutPhase, CritiqueUserOverride } from './types';

export function getCritiqueRolloutState(projectMeta?: { createdAt: string }) {
  const settings = getCritiqueRolloutSettings();
  const snapshot = getCritiqueRatchetSnapshot(settings.rolloutPhase);
  const promotion = canPromoteCritique(snapshot);
  const phase = resolveCritiqueRolloutPhase(
    settings,
    projectMeta ?? { createdAt: new Date().toISOString() },
  );
  return {
    ...settings,
    phase,
    canPromote: promotion.ok,
    canRollback: settings.rolloutPhase !== 'M0',
    reason: promotion.reason,
    next: nextCritiqueRolloutPhase(settings.rolloutPhase),
    recent: snapshot.recent,
  };
}

export async function promoteCritiqueRollout() {
  const state = getCritiqueRolloutState();
  if (!state.canPromote) {
    return { ok: false as const, state };
  }
  const next = nextCritiqueRolloutPhase(state.rolloutPhase);
  const updated = updateCritiqueRolloutSettings({
    rolloutPhase: next,
    promotedAt: { [next]: new Date().toISOString() },
  });
  await emitCritiqueEvent({
    type: 'critique.rollout.ratchet',
    from: state.rolloutPhase,
    to: next,
    reason: 'promote',
  });
  return {
    ok: true as const,
    state: getCritiqueRolloutState(),
    settings: updated,
  };
}

export async function rollbackCritiqueRollout() {
  const state = getCritiqueRolloutState();
  const updated = updateCritiqueRolloutSettings({
    rolloutPhase: 'M0',
    userOverride: 'auto',
    promotedAt: { M0: new Date().toISOString() },
  });
  await emitCritiqueEvent({
    type: 'critique.rollout.ratchet',
    from: state.rolloutPhase,
    to: 'M0',
    reason: 'rollback',
  });
  return {
    ok: true as const,
    state: getCritiqueRolloutState(),
    settings: updated,
  };
}

export function setCritiqueRolloutOverride(userOverride: CritiqueUserOverride) {
  updateCritiqueRolloutSettings({ userOverride });
  return getCritiqueRolloutState();
}

export async function getCritiqueConformanceStatus(fixturesRoot: string) {
  const report = await runCritiqueConformance({ fixturesRoot });
  const state = getCritiqueRolloutState();
  return {
    generatedAt: new Date().toISOString(),
    report,
    recent24h: {
      violations: state.recent.conformanceViolationsLast24h,
      runs: state.recent.runsLast24h,
      degradedRuns: state.recent.degradedRunsLast24h,
    },
    ratchet: {
      current: state.rolloutPhase,
      next: state.next,
      canPromote: state.canPromote,
      reason: state.reason,
    },
  };
}

export type { CritiqueRolloutPhase, CritiqueUserOverride };
