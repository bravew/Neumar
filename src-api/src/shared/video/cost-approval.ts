import type { VideoProject } from './types';

export const DEFAULT_AUTO_APPROVE_UNDER_CENTS = 25;

export interface VideoCostApproval {
  token: string;
  approvedCents?: number;
  approvedAt?: string;
  approvedBy?: 'user' | 'system';
}

export interface VideoCostGateInput {
  estimatedCents: number;
  approval?: VideoCostApproval;
  scopeId: string;
}

export interface VideoCostGateDecision {
  estimatedCents: number;
  autoApproveUnderCents: number;
  approvalRequired: boolean;
  approved: boolean;
  approvalToken?: string;
  approvedAt?: string;
}

export class VideoCostApprovalError extends Error {
  readonly code = 'cost-approval-required';
  readonly decision: VideoCostGateDecision;

  constructor(decision: VideoCostGateDecision) {
    super('cost-approval-required');
    this.name = 'VideoCostApprovalError';
    this.decision = decision;
  }
}

/**
 * The project's budget cap cannot cover the estimated spend. Carries a code so
 * the API can answer 402 rather than a generic 500.
 */
export class VideoBudgetExceededError extends Error {
  readonly code = 'budget-exceeded';
  readonly capCents: number;
  readonly spentCents: number;
  readonly estimatedCents: number;

  constructor(input: {
    capCents: number;
    spentCents: number;
    estimatedCents: number;
  }) {
    super('budget-exceeded');
    this.name = 'VideoBudgetExceededError';
    this.capCents = input.capCents;
    this.spentCents = input.spentCents;
    this.estimatedCents = input.estimatedCents;
  }
}

/**
 * Refuses work whose estimated cost would push the project past its budget cap.
 * The arithmetic matches the job pipeline's private `enforceBudget`, but throws
 * a typed error the API can map to 402 instead of an opaque 500.
 */
export function enforceProjectBudget(
  project: Pick<VideoProject, 'budget'>,
  estimatedCents: number,
): void {
  const capCents = Math.round((project.budget?.capUsd ?? 0) * 100);
  const spentCents = Math.round((project.budget?.spentUsd ?? 0) * 100);
  if (spentCents + estimatedCents > capCents) {
    throw new VideoBudgetExceededError({
      capCents,
      spentCents,
      estimatedCents,
    });
  }
}

export function buildVideoCostApprovalToken(
  projectId: string,
  scopeId: string,
  estimatedCents: number,
): string {
  return `video-cost:${projectId}:${scopeId}:${estimatedCents}`;
}

export function readVideoCostApproval(
  value: unknown,
): VideoCostApproval | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.token !== 'string' || raw.token.length === 0) {
    return undefined;
  }
  return {
    token: raw.token,
    approvedCents:
      typeof raw.approvedCents === 'number' ? raw.approvedCents : undefined,
    approvedAt: typeof raw.approvedAt === 'string' ? raw.approvedAt : undefined,
    approvedBy:
      raw.approvedBy === 'user' || raw.approvedBy === 'system'
        ? raw.approvedBy
        : undefined,
  };
}

export function enforceVideoCostApproval(
  project: VideoProject,
  input: VideoCostGateInput,
): VideoCostGateDecision {
  const estimatedCents = Math.max(0, Math.ceil(input.estimatedCents));
  const autoApproveUnderCents = resolveAutoApproveUnderCents(project);
  const approvalRequired =
    estimatedCents > 0 && estimatedCents >= autoApproveUnderCents;
  if (!approvalRequired) {
    return {
      estimatedCents,
      autoApproveUnderCents,
      approvalRequired: false,
      approved: true,
    };
  }

  const approvalToken = buildVideoCostApprovalToken(
    project.id,
    input.scopeId,
    estimatedCents,
  );
  const approved =
    input.approval?.token === approvalToken &&
    (input.approval.approvedCents ?? estimatedCents) >= estimatedCents;
  const decision: VideoCostGateDecision = {
    estimatedCents,
    autoApproveUnderCents,
    approvalRequired: true,
    approved,
    approvalToken,
    approvedAt: input.approval?.approvedAt,
  };
  if (!approved) throw new VideoCostApprovalError(decision);
  return decision;
}

export function resolveAutoApproveUnderCents(project: VideoProject): number {
  const configured = project.settings?.autoApproveUnderCents;
  if (
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return Math.floor(configured);
  }
  return DEFAULT_AUTO_APPROVE_UNDER_CENTS;
}
