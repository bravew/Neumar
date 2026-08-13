/**
 * Local-first feedback persistence.
 *
 * Writes feedback rows to SQLite before any external forwarding so submissions
 * are never lost when offline. Sync metadata is updated after Linear/remote
 * forwarding attempts.
 */

import { randomUUID } from 'crypto';

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('FeedbackStore');

export type FeedbackCategory = 'bug' | 'feature' | 'feedback' | 'question';

export type FeedbackRemoteStatus =
  | 'pending'
  | 'queued'
  | 'forwarded'
  | 'failed'
  | 'skipped';

export interface InsertFeedbackInput {
  category: FeedbackCategory;
  subject: string;
  description: string;
  email?: string;
  appName?: string;
  appVersion?: string;
  diagnostics?: object | null;
}

export interface FeedbackRow {
  id: string;
  category: FeedbackCategory;
  subject: string;
  description: string;
  email: string | null;
  app_name: string | null;
  app_version: string | null;
  diagnostics_json: string | null;
  linear_id: string | null;
  remote_status: FeedbackRemoteStatus;
  sync_attempts: number;
  last_sync_error: string | null;
  created_at: string;
  synced_at: string | null;
}

export interface ListFeedbackOptions {
  page?: number;
  limit?: number;
  category?: FeedbackCategory;
}

export interface ListFeedbackResult {
  items: FeedbackRow[];
  total: number;
  page: number;
  limit: number;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export function insertFeedback(input: InsertFeedbackInput): FeedbackRow {
  const db = getDatabase();
  const id = randomUUID();
  const diagnosticsJson = input.diagnostics
    ? JSON.stringify(input.diagnostics)
    : null;

  db.prepare(
    `INSERT INTO feedback
       (id, category, subject, description, email, app_name, app_version,
        diagnostics_json, remote_status, sync_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
  ).run(
    id,
    input.category,
    input.subject,
    input.description,
    input.email ?? null,
    input.appName ?? null,
    input.appVersion ?? null,
    diagnosticsJson,
  );

  const row = db
    .prepare('SELECT * FROM feedback WHERE id = ?')
    .get(id) as FeedbackRow;
  logger.debug(`Inserted feedback row ${id} (${input.category})`);
  return row;
}

export function listFeedback(
  options: ListFeedbackOptions = {},
): ListFeedbackResult {
  const db = getDatabase();
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, options.limit ?? DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  const where = options.category ? 'WHERE category = ?' : '';
  const params = options.category ? [options.category] : [];

  const total = (
    db
      .prepare(`SELECT COUNT(*) as c FROM feedback ${where}`)
      .get(...params) as { c: number }
  ).c;

  const items = db
    .prepare(
      `SELECT * FROM feedback ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as FeedbackRow[];

  return { items, total, page, limit };
}

export function markFeedbackForwarded(
  id: string,
  remoteStatus: FeedbackRemoteStatus,
  linearId?: string | null,
): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE feedback
       SET remote_status = ?,
           linear_id = COALESCE(?, linear_id),
           synced_at = datetime('now'),
           last_sync_error = NULL
     WHERE id = ?`,
  ).run(remoteStatus, linearId ?? null, id);
}

export function markFeedbackForwardFailed(id: string, error: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE feedback
       SET remote_status = 'failed',
           sync_attempts = sync_attempts + 1,
           last_sync_error = ?
     WHERE id = ?`,
  ).run(error.slice(0, 500), id);
}

export function setFeedbackLinearId(id: string, linearId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE feedback SET linear_id = ? WHERE id = ?').run(
    linearId,
    id,
  );
}

export function listUnsyncedFeedback(maxAttempts = 5): FeedbackRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM feedback
        WHERE remote_status IN ('pending', 'queued', 'failed')
          AND sync_attempts < ?
        ORDER BY created_at ASC`,
    )
    .all(maxAttempts) as FeedbackRow[];
}
