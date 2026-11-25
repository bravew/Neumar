// Types for verify-pr-gate.mjs so the frontend test project can import the
// plain-ESM implementation without casts. Keep in step with the .mjs file.

export type GateVerdict = 'verified' | 'blocked';
export type ReviewVerdict =
  | 'ready-for-human'
  | 'request-changes'
  | 'needs-decision';

export interface PrMetadata {
  number?: number;
  url?: string;
  state?: string;
  isDraft?: boolean;
  headRefOid?: string;
  baseRefOid?: string;
  mergeCommit?: { oid?: string } | null;
  mergeStateStatus?: string;
}

export interface CheckRunInput {
  name?: string;
  head_sha?: string;
  headSha?: string;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
  details_url?: string | null;
  app?: { id?: number; slug?: string } | null;
}

export interface VerifyPrGateInput {
  pr?: PrMetadata;
  checks?: CheckRunInput[];
  changedPaths?: string[];
  rustRequired?: boolean;
  expectedHead?: string;
  appId?: number;
  requireAggregate?: boolean;
}

export interface GateReason {
  code: string;
  message: string;
  job?: string;
}

export interface EvaluatedCheck {
  name: string;
  conclusion: string | null;
  headSha: string | null;
  url: string | null;
}

export interface GateResult {
  ok: boolean;
  verdict: GateVerdict;
  head: string | null;
  base: string | null;
  mergeCommit: string | null;
  rustRequired: boolean | null;
  requiredJobs: string[];
  reasons: GateReason[];
  checks: EvaluatedCheck[];
}

export interface VerdictDecision {
  verdict: ReviewVerdict;
  halt: boolean;
  reason: string;
}

export interface DecideReviewVerdictInput {
  ciVerified?: boolean;
  blockingFindings?: number;
  reworkCycles?: number;
  maxRework?: number;
}

export interface FormatReviewEvidenceOptions {
  allExcluded?: boolean;
  changedPaths?: string[];
  reworkCycles?: number;
  reworkLimitReached?: boolean;
}

export const REQUIRED_JOBS: readonly string[];
export const RUST_JOB: string;
export const AGGREGATE_CHECK: string;
export const GITHUB_ACTIONS_APP_ID: number;
export const MAX_REWORK_CYCLES: number;

export function verifyPrGate(input?: VerifyPrGateInput): GateResult;
export function decideReviewVerdict(
  input?: DecideReviewVerdictInput,
): VerdictDecision;
export function formatReviewEvidence(
  result: GateResult,
  options?: FormatReviewEvidenceOptions,
): string;
