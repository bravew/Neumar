/**
 * Shared types for the deterministic eval harness.
 *
 * Cases are typed `.case.ts` modules (no YAML loader required) that
 * `gate.eval.ts` and `periodic.eval.ts` consume. Each case exports a
 * default `EvalCase` value.
 */

export type EvalTier = 'gate' | 'periodic';

export interface EvalBudget {
  /** Maximum spend, in USD. Gate evals must always be 0. */
  maxUsd: number;
  /** Per-case timeout. */
  timeoutMs: number;
}

export interface EvalCase {
  id: string;
  name: string;
  tier: EvalTier;
  /**
   * Files whose modification should re-run this case. Matches the same
   * glob format used by `scripts/eval-select.js`.
   */
  touchfiles: string[];
  budget: EvalBudget;
  /**
   * Implementation. Receives a tiny harness handle for shared utilities
   * (artifact path, redaction helper) and is expected to throw on failure.
   */
  run: (ctx: EvalRunContext) => Promise<EvalResult> | EvalResult;
}

export interface EvalRunContext {
  caseId: string;
  artifactsDir: string;
  redact: (value: unknown) => unknown;
}

export interface EvalResult {
  passed: boolean;
  score?: number;
  notes?: string;
  /** Arbitrary captured metrics; will be redacted before persistence. */
  metrics?: Record<string, unknown>;
}
