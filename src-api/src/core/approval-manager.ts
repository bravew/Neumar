import { EventEmitter } from 'node:events';

import {
  createApproval,
  decideApproval,
  expireStaleApprovals,
  getApproval,
  getApprovalsByStatus,
  getPendingApprovalCount,
} from '@/shared/db/operations';
import type {
  Approval,
  ApprovalRequesterType,
  ApprovalRiskLevel,
  ApprovalType,
  CreateApprovalInput,
} from '@/shared/db/types';
import { signResumeToken } from '@/shared/services/ag-ui/resume-token';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ApprovalManager');

export type ApprovalEvent =
  | { type: 'created'; approval: Approval; resumeToken?: string }
  | { type: 'decided'; approval: Approval };

export const RISK_REQUIRES_TOKEN: ReadonlySet<ApprovalRiskLevel> = new Set([
  'high',
  'critical',
]);

export class ApprovalManager {
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  /** One listener per SSE client; cap at 100 to keep Node's leak warning useful. */
  readonly events = new EventEmitter().setMaxListeners(100);

  constructor() {
    // Sweep expired approvals every 60 seconds
    this.sweepInterval = setInterval(() => {
      try {
        const count = this.sweepExpired();
        if (count > 0) {
          logger.info(`Expired ${count} stale approval(s)`);
        }
      } catch (err) {
        logger.warn(
          'Failed to sweep expired approvals:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }, 60_000);
  }

  requestApproval(opts: {
    type: ApprovalType;
    entityType: string;
    entityId: string;
    title: string;
    description?: string;
    payload?: string;
    requesterType: ApprovalRequesterType;
    requesterId?: string;
    expiresInMinutes?: number;
    orchestrationRunId?: string;
    riskLevel?: ApprovalRiskLevel;
    /** Run ID this approval gates — required when issuing a resume token. */
    runId?: string;
  }): { approval: Approval; resumeToken?: string } {
    const id = crypto.randomUUID();
    let expiresAt: string | undefined;
    if (opts.expiresInMinutes) {
      expiresAt = new Date(Date.now() + opts.expiresInMinutes * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
    }
    const riskLevel: ApprovalRiskLevel = opts.riskLevel ?? 'medium';

    // Persist hash of the issued token; the raw token is returned to the
    // caller and never stored at rest, so verify must rely on HMAC alone.
    let signed: ReturnType<typeof signResumeToken> | undefined;
    if (opts.runId && RISK_REQUIRES_TOKEN.has(riskLevel)) {
      signed = signResumeToken({ runId: opts.runId, approvalId: id });
    }

    const input: CreateApprovalInput = {
      id,
      approval_type: opts.type,
      requested_by_type: opts.requesterType,
      requested_by_id: opts.requesterId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      title: opts.title,
      description: opts.description,
      payload: opts.payload,
      expires_at: expiresAt,
      orchestration_run_id: opts.orchestrationRunId,
      risk_level: riskLevel,
      resume_token_hash: signed?.hash,
    };
    const approval = createApproval(input);
    logger.info(
      `Approval requested: ${id} (${opts.type}, risk=${riskLevel}) for ${opts.entityType}:${opts.entityId}`,
    );
    this.events.emit('event', {
      type: 'created',
      approval,
      resumeToken: signed?.token,
    } satisfies ApprovalEvent);
    return { approval, resumeToken: signed?.token };
  }

  decide(
    approvalId: string,
    decision: 'approved' | 'rejected',
    decidedBy: string,
    reason?: string,
  ): Approval {
    const approval = decideApproval(approvalId, decision, decidedBy, reason);
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found or already decided`);
    }
    logger.info(`Approval ${approvalId} ${decision} by ${decidedBy}`);
    this.events.emit('event', {
      type: 'decided',
      approval,
    } satisfies ApprovalEvent);
    return approval;
  }

  getPending(type?: ApprovalType): Approval[] {
    const all = getApprovalsByStatus('pending');
    if (type) {
      return all.filter((a) => a.approval_type === type);
    }
    return all;
  }

  getPendingCount(): number {
    return getPendingApprovalCount();
  }

  sweepExpired(): number {
    return expireStaleApprovals();
  }

  getHistory(limit = 50): Approval[] {
    const approved = getApprovalsByStatus('approved', Math.ceil(limit / 2));
    const rejected = getApprovalsByStatus('rejected', Math.ceil(limit / 2));
    const expired = getApprovalsByStatus('expired', Math.ceil(limit / 4));
    return [...approved, ...rejected, ...expired]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  getById(id: string): Approval | undefined {
    return getApproval(id);
  }

  shutdown(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }
}

// Singleton
let approvalManager: ApprovalManager | null = null;

export function getApprovalManager(): ApprovalManager {
  if (!approvalManager) {
    approvalManager = new ApprovalManager();
  }
  return approvalManager;
}
