// Types for the #362 bug-publisher modules. Keep in step with the .mjs files.

export interface ClaimRef {
  issue: number;
  runId: string;
  epoch: number;
}

export interface PolicyViolation {
  rule: string;
  detail?: string;
  path?: string;
  field?: string;
  name?: string;
  reason?: string;
}

export interface NormalizedPathResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

export interface BranchCheck {
  ok: boolean;
  reason?: string;
  issue?: number;
  slug?: string;
  base?: string;
}

export interface IdentityCheck {
  ok: boolean;
  violations: PolicyViolation[];
}

export interface PatchPolicyInput {
  /**
   * Files changed by `baseSha..localHead`, computed by the trusted caller. The
   * worker's reported list is compared against it and never replaces it.
   */
  changedFiles: Array<string | { path: string; previousPath?: string }>;
  authorizedPaths?: string[];
  componentSizeBase?: unknown;
  componentSizeHead?: unknown;
  warningBaselineBase?: unknown;
  warningBaselineHead?: unknown;
}

export interface PatchPolicyResult {
  ok: boolean;
  violations: PolicyViolation[];
  changedFiles: string[];
}

export function normalizeRepoPath(input: unknown): NormalizedPathResult;
export function assertOwnedBranch(branch: unknown, issue: number): BranchCheck;
export function assertTargetBase(base: unknown): BranchCheck;
export function assertPublisherIdentity(
  identity: unknown,
  branch: string,
): IdentityCheck;
export function evaluatePatchPolicy(
  input?: PatchPolicyInput,
): PatchPolicyResult;

export interface VerificationCheck {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | string;
  command?: string;
  evidence?: string;
  reason?: string;
}

export interface RegressionEvidence {
  testPath: string;
  command: string;
  callerBoundary: string;
  failsOnBase: boolean;
  passesOnHead: boolean;
  baseSha: string;
  headSha: string;
}

export interface SanitizationEvidence {
  appDataDir: string;
  hostHomeUntouched: boolean;
  thirdPartyCalls: 'none' | 'stubbed' | string;
  credentialsPresent: boolean;
}

export interface Attribution {
  accountableContributor: string;
  authoringTool: string;
  sessionReference: string;
}

export interface CorrectiveEvidence {
  originalFindingLink: string;
  introducingPr: string;
  failingScenario: string;
  reviewGap: string;
  preventionTest: string;
}

export interface PrTemplate {
  title: string;
  exactHeadSha: string;
  nodeVersion: string;
  pnpmVersion: string;
  intent: string;
  affectedContracts: string;
  verificationSummary: string;
  unverified: string[];
  attribution: Attribution;
  corrective: CorrectiveEvidence | 'not applicable';
  closesIssue: number;
}

export interface VerificationReport {
  version: number;
  issue: number;
  claim: ClaimRef;
  branch: string;
  baseSha: string;
  headSha: string | null;
  reproduced: boolean;
  aborted: boolean;
  abortReason: string | null;
  sanitization: SanitizationEvidence;
  regression?: RegressionEvidence;
  checks?: VerificationCheck[];
  changedFiles?: string[];
  prTemplate?: PrTemplate;
  unverified?: string[];
}

export interface ReportExpectation {
  issue?: number;
  claim?: ClaimRef;
  branch?: string;
  baseSha?: string;
  headSha?: string;
  changedFiles?: string[];
}

export interface ValidationResult {
  ok: boolean;
  violations: PolicyViolation[];
}

export const REPORT_VERSION: number;
export function isGitSha(value: unknown): boolean;
export function isNonEmptyString(value: unknown): boolean;
export function findClosingIssues(body: unknown): number[];
export function requiredChecksForFiles(changedFiles?: string[]): string[];
export function validateVerificationReport(
  report: unknown,
  expected?: ReportExpectation,
): ValidationResult;
export function createVerificationReport(input: {
  issue: number;
  claim: ClaimRef;
  branch: string;
  baseSha: string;
  headSha: string | null;
  reproduced: boolean;
  aborted?: boolean;
  abortReason?: string | null;
  sanitization?: SanitizationEvidence;
  regression?: RegressionEvidence;
  checks?: VerificationCheck[];
  changedFiles?: string[];
  prTemplate?: PrTemplate;
  unverified?: string[];
}): VerificationReport;
export function buildPullRequestBody(report: VerificationReport): string;

export interface WorkerContext {
  issue: number;
  claim: ClaimRef;
  branch: string;
  baseSha: string;
  sandboxDir: string;
  env: Record<string, string>;
  repoAccess: 'read-only';
}

export interface PrepareWorkerInput {
  issue: number;
  claim: { runId: string; epoch: number };
  branch: string;
  baseSha: string;
  sandboxDir: string;
  baseEnv?: Record<string, string | undefined>;
  repoAccess?: string;
  tmpRoot?: string;
  repoRoot?: string;
}

export interface PrepareWorkerResult {
  ok: boolean;
  violations: PolicyViolation[];
  context: WorkerContext | null;
}

export function isDeniedEnvName(name: string): boolean;
export function assertIsolatedSandbox(
  sandboxDir: unknown,
  tmpRoot?: string,
  repoRoot?: string,
): { ok: boolean; reason?: string; sandboxDir?: string };
export function scrubWorkerEnvironment(
  baseEnv: Record<string, string | undefined>,
  sandboxDir: string,
  tmpRoot?: string,
): Record<string, string>;
export function assertWorkerEnvironment(
  env: Record<string, string>,
  tmpRoot?: string,
): ValidationResult;
export function prepareUnprivilegedWorker(
  input: PrepareWorkerInput,
): PrepareWorkerResult;
export function abortWorker(input: {
  issue: number;
  claim: { runId: string; epoch: number };
  branch: string;
  baseSha: string;
  reason: string;
  detail?: string | null;
  sanitization?: SanitizationEvidence;
}): VerificationReport;
export function finalizeWorkerReport(input: {
  context: WorkerContext | null;
  report: VerificationReport;
  changedFiles?: string[];
}): ValidationResult & { report: VerificationReport };

export type VerifyClaim = (
  state: unknown,
  ref: ClaimRef,
  now: string,
) => { ok: boolean; reason: string; claim?: unknown };

export interface FreshIssue {
  number: number;
  state: string;
  isPullRequest?: boolean;
  labels: string[];
  linkedOpenPrs?: number;
}

export type ResolveApproval = (
  issue: FreshIssue,
  trusted: Map<string, string>,
  config?: unknown,
) => { status: string; actor?: string; association?: string; at?: string };

export interface TrustedActor {
  login: string;
  association: string;
}

export interface CommitInfo {
  sha: string;
  authorLogin: string | null;
  /** The commit's single parent; the range must chain from the pinned base. */
  parentSha?: string;
}

export interface PublisherIdentity {
  kind: string;
  permissions: Record<string, string>;
  branchScope: string[];
}

export interface PublisherGit {
  push: (input: {
    branch: string;
    head: string;
    identity: PublisherIdentity;
  }) => Promise<void>;
}

export interface PullRequestInfo {
  number: number;
  headRefName: string;
  /** `owner/name` of the repository the head branch lives in. */
  headRepository?: string;
  title?: string;
  baseRefName?: string;
  state: string;
  body?: string;
  url?: string;
}

export interface PublisherGithub {
  listOpenPullRequests: (input: {
    head: string;
    issue: number;
    base: string;
  }) => Promise<PullRequestInfo[]>;
  createPullRequest: (input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }) => Promise<unknown>;
  updatePullRequest: (input: {
    number: number;
    title: string;
    body: string;
    base: string;
  }) => Promise<unknown>;
}

export interface PublishOptions {
  issue: number;
  claim: { runId: string; epoch: number };
  branch: string;
  /** `owner/name` of the repository the branch is pushed to. */
  repository: string;
  baseSha: string;
  localHead: string;
  remoteHead?: string | null;
  commitsAhead?: CommitInfo[];
  botLogin: string;
  isAncestor?: (ancestor: string, descendant: string) => boolean;
  now?: string | (() => string);
  report: VerificationReport;
  /**
   * Files changed by `baseSha..localHead`, computed by the trusted caller. The
   * worker's reported list is compared against it and never replaces it.
   */
  changedFiles: Array<string | { path: string; previousPath?: string }>;
  authorizedPaths?: string[];
  componentSizeBase?: unknown;
  componentSizeHead?: unknown;
  warningBaselineBase?: unknown;
  warningBaselineHead?: unknown;
  identity: PublisherIdentity;
  targetBase?: string;
  policy?: Partial<typeof DEFAULT_PUBLISHER_POLICY>;
  trustedActors?: TrustedActor[] | Map<string, string>;
  monitorConfig?: unknown;
  readState: () => Promise<unknown>;
  verifyClaim: VerifyClaim;
  readFreshIssue: () => Promise<FreshIssue>;
  resolveApproval: ResolveApproval;
  readBranchState?: () => Promise<{
    remoteHead?: string | null;
    commitsAhead?: CommitInfo[];
  }>;
  git?: PublisherGit;
  github?: PublisherGithub;
}

export interface PublishResult {
  published: boolean;
  reason?: string;
  pushed?: boolean;
  action?: 'created' | 'updated' | 'recovered' | 'unchanged';
  branch?: string;
  baseSha?: string;
  headSha?: string;
  targetBase?: string;
  prNumber?: number;
  prUrl?: string | null;
  violations?: PolicyViolation[];
  numbers?: number[];
  count?: number;
  error?: string;
  closing?: number[];
  report?: VerificationReport;
}

export const DEFAULT_PUBLISHER_POLICY: {
  readonly approvedLabel: string;
  readonly holdLabel: string;
  readonly needsDecisionLabel: string;
  readonly securityLabel: string;
  readonly bugLabel: string;
  readonly featureLabels: readonly string[];
};
export const DEFAULT_TARGET_BASE: string;
export function assertSafePush(input: {
  baseSha: string;
  localHead: string;
  remoteHead?: string | null;
  commitsAhead?: CommitInfo[];
  botLogin: string;
  isAncestor?: (ancestor: string, descendant: string) => boolean;
}): {
  ok: boolean;
  reason?: string;
  needsPush?: boolean;
  commitsAhead?: CommitInfo[];
  commit?: string;
  author?: string | null;
};
export function publishBugFix(options: PublishOptions): Promise<PublishResult>;

export interface PublisherAppCredentials {
  appId: string;
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string | null;
  permissions: Record<string, string>;
}

export interface FetchResponseLike {
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: Record<string, unknown>,
) => Promise<FetchResponseLike>;

export function loadPublisherAppCredentials(env?: {
  PUBLISHER_APP_ID?: string;
  PUBLISHER_APP_PRIVATE_KEY?: string;
}): PublisherAppCredentials;
export function createAppJwt(input: {
  appId: string;
  privateKey: string;
  now?: number;
}): string;
export function assertAppTokenLeastPrivilege(permissions: unknown): {
  ok: boolean;
  violations: string[];
};
export function exchangeInstallationToken(input: {
  appId: string;
  privateKey: string;
  installationId: number | string;
  /** Repository name (or `owner/name`) the token is scoped to. */
  repository: string;
  fetchImpl?: FetchLike;
  now?: number;
  apiBase?: string;
}): Promise<InstallationToken>;
export function createInstallationTokenFromEnv(input: {
  installationId: number | string;
  /** Repository name (or `owner/name`) the token is scoped to. */
  repository: string;
  env?: {
    PUBLISHER_APP_ID?: string;
    PUBLISHER_APP_PRIVATE_KEY?: string;
  };
  fetchImpl?: FetchLike;
  now?: number;
  apiBase?: string;
}): Promise<InstallationToken>;
