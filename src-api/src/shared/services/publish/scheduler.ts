import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import {
  getPublishJobRow,
  listPublishDestinationLegRows,
} from '@/shared/db/operations';
import type { PublishDestinationLegRow } from '@/shared/db/types';

import type { DestinationConfig } from './types';

export class PublishScheduler {
  private readonly db?: Database.Database;
  private readonly now: () => Date;

  constructor(deps: { db?: Database.Database; now?: () => Date } = {}) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  listReadyQueuedLegs(limit: number): PublishDestinationLegRow[] {
    const rows = this.getDb()
      .prepare(
        `SELECT * FROM publish_destination_legs
         WHERE state = 'queued'
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(this.now().toISOString(), limit) as PublishDestinationLegRow[];

    return rows.filter((row) => this.isScheduled(row));
  }

  listJobLegs(jobId: string): PublishDestinationLegRow[] {
    return listPublishDestinationLegRows(jobId, this.getDb());
  }

  isScheduled(row: PublishDestinationLegRow): boolean {
    const job = getPublishJobRow(row.job_id, this.getDb());
    const legConfig = JSON.parse(row.config_json) as DestinationConfig;
    const scheduledFor = legConfig.schedule?.runAt ?? job?.scheduled_for;
    return !scheduledFor || Date.parse(scheduledFor) <= this.now().getTime();
  }

  private getDb(): Database.Database {
    return this.db ?? getDatabase();
  }
}
