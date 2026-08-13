import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import type { AssetJob, AssetJobStatus } from '../types';
import { AssetIndexer } from './pipeline';

const logger = createLogger('Assets/Indexer');
const WORKER_INTERVAL_MS = 5_000;
const MAX_DERIVATIVE_JOB_ATTEMPTS = 3;
const DERIVATIVE_RETRY_BASE_MS = 5_000;
const DERIVATIVE_RETRY_MAX_MS = 60_000;
const RETRYABLE_DERIVATIVE_JOB_KINDS = new Set(['proxy', 'artifact']);
let workerTimer: NodeJS.Timeout | undefined;
let drainPromise: Promise<AssetJob[]> | undefined;

interface AssetJobWorkerOptions {
  db?: Database.Database;
  indexer?: AssetIndexer;
  now?: () => number;
}

export function startAssetJobWorkers(): void {
  recoverInterruptedAssetJobs();
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    scheduleAssetJobDrain();
  }, WORKER_INTERVAL_MS);
  workerTimer.unref?.();
}

export function stopAssetJobWorkers(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = undefined;
}

export function scheduleAssetJobDrain(
  limit = 2,
  options: AssetJobWorkerOptions = {},
): void {
  void drainAssetJobs(limit, options).catch((error) => {
    logger.error('assets.jobs.drain_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export function recoverInterruptedAssetJobs(
  options: AssetJobWorkerOptions = {},
): number {
  const db = options.db ?? getDatabase();
  const now = options.now?.() ?? Date.now();
  const result = db
    .prepare(
      `UPDATE asset_jobs
       SET status = 'error',
           error_text = 'interrupted',
           updated_at = ?
       WHERE status = 'running'`,
    )
    .run(now);
  return result.changes;
}

export async function drainAssetJobs(
  limit = 2,
  options: AssetJobWorkerOptions = {},
): Promise<AssetJob[]> {
  if (!options.db && !options.indexer && drainPromise) return drainPromise;
  const promise = drainAssetJobsNow(limit, options);
  if (options.db || options.indexer) return promise;
  drainPromise = promise.finally(() => {
    drainPromise = undefined;
  });
  return drainPromise;
}

async function drainAssetJobsNow(
  limit: number,
  options: AssetJobWorkerOptions,
): Promise<AssetJob[]> {
  const db = options.db ?? getDatabase();
  const indexer = options.indexer ?? new AssetIndexer({ db });
  const now = options.now ?? Date.now;
  const jobs = listQueuedJobs(db, limit, now());
  const done: AssetJob[] = [];
  for (const job of jobs) {
    done.push(await runJob(db, indexer, job, now));
  }
  return done;
}

function listQueuedJobs(
  db: Database.Database,
  limit: number,
  now: number,
): AssetJob[] {
  const rows = db
    .prepare(
      `SELECT * FROM asset_jobs
       WHERE status = 'queued'
         AND updated_at <= ?
         AND kind IN ('ingest', 'thumb', 'embed', 'reencode', 'proxy', 'artifact')
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(now, limit);
  return rows.map(rowToJob);
}

async function runJob(
  db: Database.Database,
  indexer: AssetIndexer,
  job: AssetJob,
  now: () => number,
): Promise<AssetJob> {
  // Atomically claim the job so two concurrent drains (e.g. one started with
  // explicit options, bypassing the drainPromise singleton) can't both run it.
  if (!claimQueuedJob(db, job.id, now())) return getAssetJob(db, job.id);
  try {
    const result = await indexer.runJob(job);
    const latest = getAssetJob(db, job.id);
    return latest.status === 'cancelled'
      ? latest
      : markJobDone(db, job.id, result, now);
  } catch (error) {
    logger.warn('assets.job.failed', {
      job_id: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    const latest = getAssetJob(db, job.id);
    if (latest.status === 'cancelled') return latest;
    if (shouldRetryJob(latest)) return markJobRetry(db, latest, error, now);
    return markJobError(db, job.id, error, now);
  }
}

function getAssetJob(db: Database.Database, jobId: string): AssetJob {
  const row = db.prepare(`SELECT * FROM asset_jobs WHERE id = ?`).get(jobId);
  if (!row) throw new Error('Asset job not found');
  return rowToJob(row);
}

function claimQueuedJob(
  db: Database.Database,
  jobId: string,
  now: number,
): boolean {
  const result = db
    .prepare(
      `UPDATE asset_jobs
       SET status = 'running',
           attempts = attempts + 1,
           updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .run(now, jobId);
  return result.changes === 1;
}

function markJobDone(
  db: Database.Database,
  jobId: string,
  result: Record<string, unknown>,
  now: () => number,
): AssetJob {
  db.prepare(
    `UPDATE asset_jobs
     SET status = 'done',
         result_json = ?,
         error_text = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(result), now(), jobId);
  return getAssetJob(db, jobId);
}

function markJobError(
  db: Database.Database,
  jobId: string,
  error: unknown,
  now: () => number,
): AssetJob {
  db.prepare(
    `UPDATE asset_jobs
     SET status = 'error',
         error_text = ?,
         result_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    JSON.stringify({
      code: error instanceof Error ? error.message : String(error),
    }),
    now(),
    jobId,
  );
  return getAssetJob(db, jobId);
}

function markJobRetry(
  db: Database.Database,
  job: AssetJob,
  error: unknown,
  now: () => number,
): AssetJob {
  const nextRetryAt = now() + derivativeRetryDelayMs(job.attempts);
  db.prepare(
    `UPDATE asset_jobs
     SET status = 'queued',
         error_text = ?,
         result_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    JSON.stringify({
      code: error instanceof Error ? error.message : String(error),
      retry: {
        attempts: job.attempts,
        maxAttempts: MAX_DERIVATIVE_JOB_ATTEMPTS,
        nextRetryAt,
      },
    }),
    nextRetryAt,
    job.id,
  );
  logger.warn('assets.job.retry_scheduled', {
    attempts: job.attempts,
    job_id: job.id,
    kind: job.kind,
    next_retry_at: nextRetryAt,
  });
  return getAssetJob(db, job.id);
}

function shouldRetryJob(job: AssetJob): boolean {
  return (
    RETRYABLE_DERIVATIVE_JOB_KINDS.has(job.kind) &&
    job.attempts < MAX_DERIVATIVE_JOB_ATTEMPTS
  );
}

function derivativeRetryDelayMs(attempts: number): number {
  return Math.min(
    DERIVATIVE_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
    DERIVATIVE_RETRY_MAX_MS,
  );
}

function rowToJob(row: unknown): AssetJob {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.id),
    kind: String(value.kind),
    status: String(value.status) as AssetJobStatus,
    payload: parseJson(value.payload_json),
    result: parseJson(value.result_json),
    errorText: value.error_text ? String(value.error_text) : null,
    createdAt: Number(value.created_at ?? 0),
    updatedAt: Number(value.updated_at ?? 0),
    cancelledAt:
      value.cancelled_at === null || value.cancelled_at === undefined
        ? null
        : Number(value.cancelled_at),
    attempts: Number(value.attempts ?? 0),
  };
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
