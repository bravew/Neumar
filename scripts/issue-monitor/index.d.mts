// Types for the issue-monitor modules, so the frontend test project can import
// the plain-ESM implementation without casts. Keep in step with the .mjs files.

export interface MonitorLabels {
  approved: string;
  hold: string;
  needsDecision: string;
  bug: string;
  security: string;
  features: readonly string[];
}

export interface MonitorConfig {
  labels: MonitorLabels;
  trustedAssociations: readonly string[];
  leaseTtlMs: number;
  overlapMs: number;
  maxClaimsPerDay: number;
  maxAttemptsPerIssue: number;
  deliveryMemory: number;
}

export type MonitorConfigOverrides = Partial<
  Omit<MonitorConfig, 'labels'> & { labels: Partial<MonitorLabels> }
>;

export interface LabelEvent {
  event: 'labeled' | 'unlabeled';
  label: string;
  actor: string | null;
  createdAt: string;
}

export interface IssueRead {
  number: number;
  state: string;
  isPullRequest: boolean;
  labels: string[];
  updatedAt?: string;
  linkedOpenPrs: number;
  labelEvents: LabelEvent[] | null;
}

export interface TrustedActor {
  login: string;
  association: string;
}

export interface ReadResult {
  ok: boolean;
  complete: boolean;
  startedAt?: string;
  error?: string;
  trustedActors?: TrustedActor[];
  issues: IssueRead[];
}

export interface Claim {
  runId: string;
  epoch: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  attempt: number;
  approval: { actor: string; at: string };
}

export interface MonitorState {
  version: number;
  disabled: boolean;
  watermark: { updatedSince: string; tickAt: string } | null;
  epoch: number;
  claims: Record<string, Claim>;
  attempts: Record<string, number>;
  deferred: number[];
  budget: { day: string | null; claims: number };
  seenDeliveries: string[];
}

export interface AuditEntry {
  ts: string;
  trigger: 'event' | 'cron';
  deliveryId: string | null;
  runId: string;
  issue: number | null;
  actorAssociation: string | null;
  decision: 'claim' | 'skip' | 'revoke' | 'abort';
  reason: string;
  detail?: string;
  watermarkBefore: string | null;
  watermarkAfter: string | null;
}

export interface TickInput {
  trigger: 'event' | 'cron';
  deliveryId?: string | null;
  now: string;
  runId: string;
  read: ReadResult;
}

export interface TickPlan {
  outcome: string;
  state: MonitorState;
  changed: boolean;
  claims: Array<{ issue: number } & Claim>;
  audit: AuditEntry[];
  watermark: { before: string | null; after: string | null };
}

export interface ClaimRef {
  issue: number;
  runId: string;
  epoch: number;
}

export interface Transition {
  ok: boolean;
  reason: string;
  state: MonitorState;
  issues?: number[];
}

export const DEFAULT_CONFIG: MonitorConfig;
export function resolveConfig(
  overrides?: MonitorConfigOverrides,
): MonitorConfig;

export function resolveApproval(
  issue: IssueRead,
  trusted: Map<string, string>,
  config?: MonitorConfig,
): {
  status: 'absent' | 'unverifiable' | 'untrusted' | 'approved';
  actor?: string;
  association?: string;
  at?: string;
};
export function decideIssue(
  issue: IssueRead,
  trusted: Map<string, string>,
  config?: MonitorConfig,
): { eligible: boolean; reason: string };

export function emptyState(): MonitorState;
export function pollSince(
  state: MonitorState,
  config?: MonitorConfig,
): string | null;
export function followUpNumbers(state: MonitorState): number[];
export function verifyClaim(
  state: MonitorState,
  ref: ClaimRef,
  now: string,
): { ok: boolean; reason: string; claim?: Claim };
export function heartbeat(
  state: MonitorState,
  ref: ClaimRef,
  now: string,
  config?: MonitorConfig,
): Transition;
export function release(state: MonitorState, ref: ClaimRef): Transition;
export function setDisabled(
  state: MonitorState,
  disabled: boolean,
): MonitorState;
export function resume(state: MonitorState, now: string): Transition;

export class InMemoryStore {
  constructor(initial?: MonitorState);
  read(): Promise<{ state: MonitorState; version: number }>;
  compareAndSwap(
    expectedVersion: number,
    next: MonitorState,
  ): Promise<{ ok: boolean; version?: number }>;
  readonly snapshot: MonitorState;
}

export function planTick(
  prev: MonitorState,
  input: TickInput,
  config?: MonitorConfig,
): TickPlan;
export function runTick(
  options: TickInput & {
    store: InMemoryStore;
    dispatch?: (claim: { issue: number } & Claim) => Promise<void>;
    config?: MonitorConfig;
  },
): Promise<TickPlan & { dispatched: number[]; casRetries: number }>;

export type GhRunner = (args: string[]) => Promise<unknown>;
export function assertReadOnlyGhArgs(args: string[]): void;
export function createGhRunner(): GhRunner;
export function collectSnapshot(options: {
  gh: GhRunner;
  repo: { owner: string; name: string };
  since?: string | null;
  numbers?: number[];
  window?: boolean;
  approvedOnly?: boolean;
  now?: () => Date;
  config?: MonitorConfig;
  maxIssues?: number;
}): Promise<ReadResult>;

export interface ScenarioTick {
  op?: string;
  trigger?: 'event' | 'cron';
  deliveryId?: string;
  now: string;
  runId?: string;
  issue?: number;
  epoch?: number;
  dispatchFails?: boolean;
  read?: {
    ok: boolean;
    complete?: boolean;
    error?: string;
    issues?: string[];
    startedAt?: string;
  };
  expect?: Record<string, unknown>;
}

export interface Scenario {
  name: string;
  description: string;
  config?: MonitorConfigOverrides;
  trustedActors: TrustedActor[];
  issues: Record<string, IssueRead>;
  initialState?: Partial<MonitorState>;
  ticks: ScenarioTick[];
}

export function replayScenario(scenario: Scenario): Promise<{
  trace: Array<Record<string, unknown> & { audit?: AuditEntry[] }>;
  finalState: MonitorState;
  followUps: number[];
}>;

export interface RehearsalTick {
  tick: number;
  outcome: string;
  watermark: { before: string | null; after: string | null };
  wouldClaim: number[];
  audit: AuditEntry[];
}
export function rehearse(snapshots: ReadResult[]): RehearsalTick[];
export function formatRehearsal(ticks: RehearsalTick[]): string;
