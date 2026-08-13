import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import {
  getPublishDestinationLegRow,
  listPublishDestinationLegRows,
  updatePublishDestinationLegRow,
} from '@/shared/db/operations';
import type { PublishDestinationLegRow } from '@/shared/db/types';

import type { DestinationConfig } from './types';

export interface ApprovalRequest {
  legId: string;
  jobId: string;
  required: boolean;
  approved: boolean;
}

export class PublishApprovalService {
  private readonly db?: Database.Database;
  private readonly now: () => Date;

  constructor(deps: { db?: Database.Database; now?: () => Date } = {}) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  requestApproval(legId: string): ApprovalRequest {
    const row = this.requireLeg(legId);
    return {
      legId,
      jobId: row.job_id,
      required: this.requiresApproval(row),
      approved: Boolean(row.approved_at),
    };
  }

  approveLeg(legId: string, byUserId: string): void {
    updatePublishDestinationLegRow(
      legId,
      {
        approved_by: byUserId,
        approved_at: this.now().toISOString(),
      },
      this.getDb(),
    );
  }

  rejectLeg(legId: string, byUserId: string, reason: string): void {
    updatePublishDestinationLegRow(
      legId,
      {
        state: 'canceled',
        approved_by: byUserId,
        approved_at: this.now().toISOString(),
        rejection_reason: reason,
        error_class: 'approval_rejected',
        error_message: reason,
        updated_at: this.now().toISOString(),
      },
      this.getDb(),
    );
  }

  approveJob(jobId: string, byUserId: string): number {
    const legs = listPublishDestinationLegRows(jobId, this.getDb());
    let count = 0;
    for (const leg of legs) {
      if (this.requiresApproval(leg) && !leg.approved_at) {
        this.approveLeg(leg.id, byUserId);
        count += 1;
      }
    }
    return count;
  }

  canRun(row: PublishDestinationLegRow): boolean {
    return !this.requiresApproval(row) || Boolean(row.approved_at);
  }

  requiresApproval(row: PublishDestinationLegRow): boolean {
    if (row.approval_required) return true;
    return parseConfig(row).approvalRequired === true;
  }

  private requireLeg(legId: string): PublishDestinationLegRow {
    const row = getPublishDestinationLegRow(legId, this.getDb());
    if (!row) throw new Error(`Publish leg not found: ${legId}`);
    return row;
  }

  private getDb(): Database.Database {
    return this.db ?? getDatabase();
  }
}

function parseConfig(row: PublishDestinationLegRow): DestinationConfig {
  return JSON.parse(row.config_json) as DestinationConfig;
}
