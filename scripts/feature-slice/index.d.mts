// Types for the #365 feature-slice adapter. Keep in step with the .mjs files.

import type {
  CommitInfo,
  PolicyViolation,
  PrTemplate,
  PublisherGithub,
  PublisherGit,
  PublisherIdentity,
  WorkerContext,
} from '../bug-publisher/index.mjs';
import type { CheckRunInput, PrMetadata } from '../verify-pr-gate.mjs';

export type SliceOutcome =
  | 'proceed'
  | 'published'
  | 'return-to-planning'
  | 'paused'
  | 'paused-out-of-scope'
  | 'refused';

export interface SliceClaim {
  digest: string;
  epicBranch: string;
  slice: string;
}

export interface SliceScope {
  owned: string[];
  shared: string[];
  depends: string[];
}

export interface SliceIssueState {
  number: number;
  state: string;
  labels: string[];
  isPullRequest?: boolean;
}

/** The input documented on `evaluateFeatureClaim`, without `slice`. */
export interface ApprovalInput {
  readComplete: boolean;
  issue: { state: string; labels: string[]; authorLogin: string };
  briefText: string | null;
  comments: Array<{
    id: number | string;
    authorLogin: string;
    authorAssociation: string;
    authorType: string;
    createdAt: string;
    updatedAt: string;
    body: string;
  }>;
}

export type ChangedFile = string | { path: string; previousPath?: string };

export interface ScopeInput {
  owned: string[];
  shared: string[];
  changedFiles: ChangedFile[];
  componentSizeBase?: unknown;
  componentSizeHead?: unknown;
  warningBaselineBase?: unknown;
  warningBaselineHead?: unknown;
}

export interface ScopeResult {
  ok: boolean;
  outcome: 'in-scope' | 'paused-out-of-scope';
  violations: PolicyViolation[];
  changedFiles: string[];
}

export function evaluateSliceScope(input?: Partial<ScopeInput>): ScopeResult;

export interface SerializationBlocker {
  rule: string;
  path?: string;
  slices: string[];
}

export function checkMergeSerialization(input?: {
  slices: Array<{ id: string; shared: string[]; depends: string[] }>;
  pending: Array<{ sliceId: string; changedFiles: ChangedFile[] }>;
}): {
  ok: boolean;
  outcome: 'serialized' | 'blocked-until-serialized';
  blockers: SerializationBlocker[];
};

export interface ApprovalReaders {
  sliceIssue: number;
  readSliceIssue: () => Promise<SliceIssueState>;
  readApprovalInput: () => Promise<ApprovalInput>;
}

export type VerifySliceApprovalResult =
  | {
      ok: true;
      scope: SliceScope;
      userFacing: boolean;
      digest: string;
      epicBranch: string;
    }
  | {
      ok: false;
      outcome: SliceOutcome;
      reason: string;
      reasons?: string[];
    };

export function verifySliceApproval(
  input: ApprovalReaders & { claim: SliceClaim },
): Promise<VerifySliceApprovalResult>;

export interface StartWorkerOptions extends ApprovalReaders {
  sliceId: string;
  lease: { runId: string; epoch: number };
  branch: string;
  baseSha: string;
  sandboxDir: string;
  baseEnv?: Record<string, string | undefined>;
  repoAccess?: string;
  tmpRoot?: string;
  repoRoot?: string;
}

export interface StartWorkerResult {
  started: boolean;
  outcome: SliceOutcome;
  reason?: string;
  reasons?: string[];
  question?: string;
  violations?: PolicyViolation[];
  claim?: SliceClaim;
  targetBase?: string;
  scope?: SliceScope;
  userFacing?: boolean;
  context?: WorkerContext;
}

export function startFeatureSliceWorker(
  options: StartWorkerOptions,
): Promise<StartWorkerResult>;

export const SLICE_REPORT_VERSION: number;

export interface SliceReport {
  version: number;
  issue: number;
  sliceId: string;
  digest: string;
  branch: string;
  baseSha: string;
  headSha: string;
  aborted?: boolean;
  changedFiles: string[];
  checks: Array<{
    name: string;
    status: string;
    command?: string;
    evidence?: string;
    reason?: string;
  }>;
  callerEvidence: {
    surface: string;
    testPath: string;
    command: string;
    passesOnHead: boolean;
    headSha: string;
  };
  userVisibleEvidence: string;
  prTemplate: Omit<PrTemplate, 'corrective'> & {
    corrective?: PrTemplate['corrective'];
  };
}

export function epicIssueNumber(epicBranch: string): number | null;
export function findClosingReferences(
  body: unknown,
): Array<{ token: string; issue: number | null }>;
export function validateSliceReport(
  report: unknown,
  expected: {
    sliceIssue: number;
    sliceId: string;
    digest: string;
    branch: string;
    baseSha: string;
    headSha: string;
    changedFiles: string[];
    userFacing: boolean;
  },
): { ok: boolean; violations: Array<Record<string, unknown>> };
export function buildSlicePullRequestBody(
  report: SliceReport,
  context: {
    sliceIssue: number;
    sliceId: string;
    epicBranch: string;
    digest: string;
  },
): string;

export interface PublishSliceOptions extends ApprovalReaders {
  sliceId: string;
  claim: SliceClaim;
  branch: string;
  repository: string;
  baseSha: string;
  localHead: string;
  remoteHead?: string | null;
  commitsAhead?: CommitInfo[];
  botLogin: string;
  isAncestor?: (ancestor: string, descendant: string) => boolean;
  report: SliceReport;
  changedFiles: ChangedFile[];
  componentSizeBase?: unknown;
  componentSizeHead?: unknown;
  warningBaselineBase?: unknown;
  warningBaselineHead?: unknown;
  identity: PublisherIdentity;
  targetBase?: string;
  readBranchState?: () => Promise<{
    remoteHead?: string | null;
    commitsAhead?: CommitInfo[];
  }>;
  git?: PublisherGit;
  github?: PublisherGithub;
}

export interface PublishSliceResult {
  published: boolean;
  outcome: SliceOutcome;
  reason?: string;
  reasons?: string[];
  action?: 'created' | 'updated' | 'recovered' | 'unchanged';
  pushed?: boolean;
  branch?: string;
  baseSha?: string;
  headSha?: string;
  targetBase?: string;
  closes?: number;
  prNumber?: number;
  prUrl?: string | null;
  violations?: PolicyViolation[] | Array<Record<string, unknown>>;
  numbers?: number[];
  count?: number;
  closing?: Array<{ token: string; issue: number | null }>;
  error?: string;
}

export function publishFeatureSlice(
  options: PublishSliceOptions,
): Promise<PublishSliceResult>;

export interface ReviewRecord {
  headSha: string;
  verdict: string;
  reviewer: string;
  recordedAt: string;
  blockingFindings: number;
  reworkCycles?: number;
}

export interface EpicReadinessOptions {
  epicBranch: string;
  readEpicHead: () => Promise<string>;
  readGateInputs: (head: string) => Promise<{
    pr: PrMetadata;
    checks: CheckRunInput[];
    changedPaths?: string[];
  }>;
  readReview: (head: string) => Promise<ReviewRecord | null>;
  hasFileAtRef: (ref: string, path: string) => Promise<boolean>;
  /** Logins that authored or published the work; none may be the reviewer. */
  publisherLogins?: string[];
  browserE2eRequired?: boolean;
  maxReviewAgeMs?: number;
  now?: string | Date | (() => string | Date);
}

export interface EpicReadinessResult {
  ready: boolean;
  head: string | null;
  epicBranch?: string;
  reasons: Array<{ code: string; message: string }>;
  autoMerge: false;
  nextStep: string;
}

export const REQUIRED_EPIC_FILES: readonly string[];
export const DEFAULT_MAX_REVIEW_AGE_MS: number;
export function checkEpicReadiness(
  options?: Partial<EpicReadinessOptions>,
): Promise<EpicReadinessResult>;

export function digestBrief(text: string): string;
