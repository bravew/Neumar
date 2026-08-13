import type { DesignJuryRole, DesignJuryRoleScore } from '../../types';
import type {
  CritiquePanelistAdapter,
  CritiquePanelistCapability,
  CritiquePanelistTranscript,
} from './types';

export function createScoreboardCritiqueAdapter(
  role: DesignJuryRole,
  capability: CritiquePanelistCapability,
): CritiquePanelistAdapter {
  return {
    id: `scoreboard-${capability}-${role}`,
    role,
    capability,
    async run(context) {
      if (context.signal.aborted) {
        return { ok: false, reason: 'aborted' };
      }
      const transcript = roleScoreToTranscript(
        context.roleScore,
        context.round,
        capability === 'degraded'
          ? [`degraded:${context.fallbackReason ?? role}`]
          : [],
      );
      return { ok: true, transcript };
    },
  };
}

function roleScoreToTranscript(
  roleScore: DesignJuryRoleScore,
  round: number,
  parserWarnings: string[],
): CritiquePanelistTranscript {
  return {
    role: roleScore.role,
    round,
    score: roleScore.score,
    passes: roleScore.mustFix.length === 0,
    evidence: roleScore.evidence,
    mustFix: roleScore.mustFix,
    quickWins: roleScore.quickWins,
    parserWarnings,
  };
}
