import type { DesignJuryRole, DesignJuryRoleScore } from '../../types';

export type CritiquePanelistCapability = 'primary' | 'degraded';
export type CritiqueAdapterFailureReason =
  | 'timeout'
  | 'parse_failed'
  | 'budget_exceeded'
  | 'provider_error'
  | 'aborted';

export interface CritiquePanelistAdapterContext {
  runId: string;
  projectId: string;
  role: DesignJuryRole;
  round: number;
  artifactPath: string;
  artifactContent: string;
  roleScore: DesignJuryRoleScore;
  fallbackReason?: CritiqueAdapterFailureReason;
  signal: AbortSignal;
}

export interface CritiquePanelistTranscript {
  role: DesignJuryRole;
  round: number;
  score: number;
  passes: boolean;
  evidence: string;
  mustFix: readonly string[];
  quickWins: readonly string[];
  parserWarnings: readonly string[];
}

export type CritiquePanelistAdapterResult =
  | { ok: true; transcript: CritiquePanelistTranscript }
  | {
      ok: false;
      reason: CritiqueAdapterFailureReason;
      fallback?: string;
    };

export interface CritiquePanelistAdapter {
  readonly id: string;
  readonly role: DesignJuryRole;
  readonly capability: CritiquePanelistCapability;
  run(
    context: CritiquePanelistAdapterContext,
  ): Promise<CritiquePanelistAdapterResult>;
}
