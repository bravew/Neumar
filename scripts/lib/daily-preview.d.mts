export const GATE_CHECK_NAME: string;
export const GATE_APP_ID: number;
export const POINTER_BRANCH: string;
export const POINTER_FILE: string;

export interface Pointer {
  schema: 1;
  sha: string;
  advancedAt: string;
  runUrl: string;
  artifact: string;
}

export type CiVerdict =
  | { ok: true }
  | {
      ok: false;
      state: 'unknown' | 'missing' | 'pending' | 'failed';
      detail: string;
    };

export interface Plan {
  action: 'build' | 'no-change' | 'abort';
  reason: string;
  range: string;
}

export function isFullSha(value: unknown): value is string;
export function parsePointer(text: string): Pointer;
export function evaluateCiGate(payload: unknown, sha: string): CiVerdict;
export function decidePlan(input: {
  candidateSha: string;
  lastGoodSha: string | null | undefined;
  ci: CiVerdict | undefined;
}): Plan;
export function artifactBaseName(input: { date: string; sha: string }): string;
export function nextPointer(input: {
  current: Pointer | null;
  expectedPrevious: string | null | undefined;
  candidateSha: string;
  verified: boolean;
  now: string;
  runUrl: string;
  artifact: string;
}): Pointer;
export function parseSha256Sums(text: string): Map<string, string>;
export function checkChecksums(
  sumsText: string,
  actual: Record<string, string>,
): { ok: boolean; problems: string[] };
