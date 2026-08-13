import type { DesignJuryRole } from '../../types';
import { createScoreboardCritiqueAdapter } from './scoreboard-adapter';
import type { CritiquePanelistAdapter } from './types';

export function createDegradedCritiqueAdapter(
  role: DesignJuryRole,
): CritiquePanelistAdapter {
  return createScoreboardCritiqueAdapter(role, 'degraded');
}
