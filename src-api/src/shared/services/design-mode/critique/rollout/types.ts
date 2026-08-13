export const CRITIQUE_ROLLOUT_PHASES = ['M0', 'M1', 'M2', 'M3', 'GA'] as const;
export type CritiqueRolloutPhase = (typeof CRITIQUE_ROLLOUT_PHASES)[number];
export type CritiqueUserOverride = 'auto' | 'on' | 'off';

export interface CritiqueRolloutSettings {
  rolloutPhase: CritiqueRolloutPhase;
  userOverride: CritiqueUserOverride;
  promotedAt: Partial<Record<CritiqueRolloutPhase, string>>;
}

export interface CritiqueRolloutState extends CritiqueRolloutSettings {
  phase: CritiqueRolloutPhase;
  canPromote: boolean;
  canRollback: boolean;
  reason?: string;
  next?: CritiqueRolloutPhase;
}
