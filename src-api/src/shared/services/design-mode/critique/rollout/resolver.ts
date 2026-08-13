import type { CritiqueRolloutPhase, CritiqueRolloutSettings } from './types';

const PHASE_ORDER: CritiqueRolloutPhase[] = ['M0', 'M1', 'M2', 'M3', 'GA'];

export function resolveCritiqueRolloutPhase(
  settings: CritiqueRolloutSettings,
  projectMeta: { createdAt: string },
): CritiqueRolloutPhase {
  if (process.env.DESIGNMODE_CRITIQUE_DARK_LAUNCH === '0') return 'M0';
  if (settings.userOverride === 'off') return 'M0';
  if (settings.userOverride === 'on') {
    return clampMinimum(settings.rolloutPhase, 'M1');
  }
  if (settings.rolloutPhase === 'M2') {
    const promotedAt = settings.promotedAt.M2;
    if (promotedAt && projectMeta.createdAt <= promotedAt) return 'M1';
  }
  return settings.rolloutPhase;
}

export function nextCritiqueRolloutPhase(
  phase: CritiqueRolloutPhase,
): CritiqueRolloutPhase {
  const index = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[
    Math.min(index + 1, PHASE_ORDER.length - 1)
  ] as CritiqueRolloutPhase;
}

export function previousCritiqueRolloutPhase(
  phase: CritiqueRolloutPhase,
): CritiqueRolloutPhase {
  const index = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[Math.max(index - 1, 0)] as CritiqueRolloutPhase;
}

function clampMinimum(
  phase: CritiqueRolloutPhase,
  minimum: CritiqueRolloutPhase,
) {
  return PHASE_ORDER.indexOf(phase) < PHASE_ORDER.indexOf(minimum)
    ? minimum
    : phase;
}
