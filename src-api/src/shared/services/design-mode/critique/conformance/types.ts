import type { DesignJuryRole } from '../../types';
import type {
  CritiquePanelistCapability,
  CritiquePanelistTranscript,
} from '../adapters/types';

export interface CritiqueConformanceCheck {
  adapterId: string;
  role: DesignJuryRole;
  caseId: string;
  ok: boolean;
  diff?: { field: string; expected: unknown; actual: unknown }[];
}

export interface CritiqueConformanceReport {
  generatedAt: string;
  adapters: ReadonlyArray<{
    id: string;
    role: DesignJuryRole;
    capability: CritiquePanelistCapability;
  }>;
  checks: ReadonlyArray<CritiqueConformanceCheck>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    failuresByAdapter: Record<string, number>;
  };
}

export type CritiqueConformanceExpected = CritiquePanelistTranscript;
