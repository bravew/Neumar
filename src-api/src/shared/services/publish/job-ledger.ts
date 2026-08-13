import crypto from 'crypto';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import {
  getPublishDestinationLegRow,
  getPublishDestinationLegRowByIdentity,
  getPublishJobRow,
  getPublishJobRowByIdempotencyKey,
  insertPublishDestinationLegRow,
  insertPublishJobRow,
  listPublishDestinationLegRows,
  listPublishJobRows,
  updatePublishDestinationLegRow,
  updatePublishJobRow,
} from '@/shared/db/operations';
import type {
  PublishDestinationLegRow,
  PublishJobRow,
} from '@/shared/db/types';

import {
  assertLegTransition,
  isLegStalled,
  isTerminalJobState,
  isTerminalLegState,
  jobStateSchema,
  legStateSchema,
  type LegState,
} from './state-machine';
import type {
  CreateJobInput,
  DestinationConfig,
  DestinationKind,
  DestinationLegRow,
  JobFilter,
  PublishedRef,
  PublishLegPlan,
  PublishJob,
  PublishMetadata,
  SourceArtifact,
} from './types';
import { destinationKindSchema } from './types';
import {
  DEFAULT_PUBLISH_WORKFLOW_VERSION,
  resolvePublishWorkflow,
} from './workflows';

export interface JobLedgerDeps {
  db?: Database.Database;
  now?: () => Date;
}

export type LegRowPatch = Partial<
  Pick<
    DestinationLegRow,
    | 'plan_json'
    | 'session_id'
    | 'total_bytes'
    | 'attempts'
    | 'provider_response_json'
    | 'error_class'
    | 'error_message'
    | 'next_retry_at'
  >
>;

export class JobLedger {
  private readonly db?: Database.Database;
  private readonly now: () => Date;
  private readonly jobLocks = new Map<string, Promise<void>>();

  constructor(deps: JobLedgerDeps = {}) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  createJob(input: CreateJobInput): PublishJob {
    const db = this.getDb();
    const idempotencyKey =
      input.idempotencyKey ?? this.createJobIdempotencyKey(input);
    const existing = getPublishJobRowByIdempotencyKey(idempotencyKey, db);
    if (existing) return this.inflateJob(existing);

    const jobId = input.id ?? crypto.randomUUID();
    const metadata = input.metadata ?? {};
    const approval = input.approval ?? {
      required: input.destinations.some((leg) => leg.approvalRequired),
    };
    const state = approval.required ? 'pending_approval' : 'drafted';
    const workflow = resolvePublishWorkflow(input.workflowVersion);
    const workflowState =
      input.workflowState ??
      workflow.createInitialState({
        ...input,
        jobId,
        idempotencyKey,
        state,
        createdAt: this.nowSql(),
      });

    const tx = db.transaction(() => {
      insertPublishJobRow(
        {
          id: jobId,
          workspace_id: input.workspaceId,
          created_by: input.createdBy,
          artifact_id: input.source.artifactId ?? null,
          source_artifact_path: input.source.path,
          source_sha256: input.source.sha256,
          source_size_bytes: input.source.sizeBytes,
          source_mime: input.source.mime,
          source_provenance_json: input.source.provenance
            ? JSON.stringify(input.source.provenance)
            : null,
          source_json: JSON.stringify(input.source),
          signed_artifact_path: input.signedArtifactPath ?? null,
          manifest_path:
            input.manifestPath ?? input.source.manifestPath ?? null,
          provenance_state: input.provenanceState ?? 'unchecked',
          state,
          approval_required: approval.required ? 1 : 0,
          approval_channel: approval.channel ?? null,
          scheduled_for: input.scheduledFor ?? null,
          idempotency_key: idempotencyKey,
          metadata_json: JSON.stringify(metadata),
          workflow_version: workflow.version,
          workflow_state_json: JSON.stringify(workflowState),
        },
        db,
      );

      for (const destination of input.destinations) {
        this.enqueueLegInternal(jobId, destination, input.source, db);
      }
    });

    tx();
    const row = getPublishJobRow(jobId, db);
    if (!row) throw new Error(`Failed to create publish job ${jobId}`);
    return this.inflateJob(row);
  }

  enqueueLeg(jobId: string, leg: DestinationConfig): DestinationLegRow {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const job = getPublishJobRow(jobId, db);
      if (!job) throw new Error(`Publish job not found: ${jobId}`);
      return this.enqueueLegInternal(jobId, leg, this.parseSource(job), db);
    });
    return this.mapLegRow(tx());
  }

  markLegState(legId: string, next: LegState, patch: LegRowPatch = {}): void {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireLeg(legId, db);
      assertLegTransition(row.state, next);

      const now = this.nowSql();
      const updates: Partial<PublishDestinationLegRow> = {
        ...patch,
        state: next,
        updated_at: now,
      };
      if (next === 'uploading' && row.state !== 'uploading') {
        updates.last_progress_at = now;
      }
      if (next === 'published') {
        updates.published_at = now;
      }
      updatePublishDestinationLegRow(legId, updates, db);
      this.rollupJobState(row.job_id, db);
    });
    tx();
  }

  recordChunkProgress(legId: string, offset: number, etags?: string[]): void {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Invalid chunk offset: ${offset}`);
    }

    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireLeg(legId, db);
      if (isTerminalLegState(row.state)) {
        throw new Error(`Cannot update terminal publish leg ${legId}`);
      }
      if (offset < row.chunk_offset_bytes) {
        throw new Error(
          `Refusing to move publish leg ${legId} offset backward`,
        );
      }
      const now = this.nowSql();
      updatePublishDestinationLegRow(
        legId,
        {
          chunk_offset_bytes: offset,
          etags_json: etags ? JSON.stringify(etags) : row.etags_json,
          last_progress_at: now,
          updated_at: now,
        },
        db,
      );
    });
    tx();
  }

  recordLegPlan(legId: string, plan: PublishLegPlan): void {
    const db = this.getDb();
    const tx = db.transaction(() => {
      this.requireLeg(legId, db);
      updatePublishDestinationLegRow(
        legId,
        {
          plan_json: JSON.stringify(plan),
          updated_at: this.nowSql(),
        },
        db,
      );
    });
    tx();
  }

  recordInboundManifest(
    jobId: string,
    inboundManifest: Record<string, unknown>,
  ): void {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireJob(jobId, db);
      const metadata = this.parseJson<Record<string, unknown>>(
        row.metadata_json,
        {},
      );
      metadata.inbound_manifest = inboundManifest;
      updatePublishJobRow(
        jobId,
        {
          metadata_json: JSON.stringify(metadata),
          updated_at: this.nowSql(),
        },
        db,
      );
    });
    tx();
  }

  recordProvenanceSigned(
    jobId: string,
    input: {
      signedArtifactPath: string;
      manifestPath: string;
      contentSha256: string;
      manifestSha256: string;
      signerMode: string;
      runner: Record<string, unknown>;
    },
  ): void {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireJob(jobId, db);
      const metadata = this.parseJson<Record<string, unknown>>(
        row.metadata_json,
        {},
      );
      metadata.c2pa = {
        content_sha256: input.contentSha256,
        manifest_sha256: input.manifestSha256,
        signer_mode: input.signerMode,
        runner: input.runner,
        signed_at: this.nowSql(),
      };
      updatePublishJobRow(
        jobId,
        {
          provenance_state: 'signed',
          signed_artifact_path: input.signedArtifactPath,
          manifest_path: input.manifestPath,
          metadata_json: JSON.stringify(metadata),
          updated_at: this.nowSql(),
        },
        db,
      );
    });
    tx();
  }

  recordProvenanceFailed(
    jobId: string,
    error: unknown,
    inboundManifest?: Record<string, unknown>,
  ): void {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireJob(jobId, db);
      const metadata = this.parseJson<Record<string, unknown>>(
        row.metadata_json,
        {},
      );
      if (inboundManifest) metadata.inbound_manifest = inboundManifest;
      metadata.c2pa_error = {
        message: error instanceof Error ? error.message : String(error),
        failed_at: this.nowSql(),
      };
      updatePublishJobRow(
        jobId,
        {
          provenance_state: 'failed',
          metadata_json: JSON.stringify(metadata),
          updated_at: this.nowSql(),
        },
        db,
      );
    });
    tx();
  }

  recordPublishedRef(legId: string, ref: PublishedRef): void {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireLeg(legId, db);
      const now = this.nowSql();

      updatePublishDestinationLegRow(
        legId,
        {
          published_ref_json: JSON.stringify(ref),
          updated_at: now,
        },
        db,
      );

      assertLegTransition(row.state, 'published');
      updatePublishDestinationLegRow(
        legId,
        {
          state: 'published',
          provider_response_json: JSON.stringify(ref),
          published_at: now,
          updated_at: now,
        },
        db,
      );
      this.rollupJobState(row.job_id, db);
    });
    tx();
  }

  recordNotificationDelivered(legId: string, channelRef: string): void {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireLeg(legId, db);
      if (row.notification_delivered_at) return;
      updatePublishDestinationLegRow(
        legId,
        {
          notification_channel_ref: channelRef,
          notification_delivered_at: this.nowSql(),
          updated_at: this.nowSql(),
        },
        db,
      );
    });
    tx();
  }

  acquireLegLease(legId: string, workerId: string, ttlMs: number): boolean {
    const db = this.getDb();
    const now = this.nowSql();
    const leaseUntil = this.dateAfter(ttlMs);
    const result = db
      .prepare(
        `UPDATE publish_destination_legs
         SET locked_by = ?, lease_until = ?, updated_at = ?
         WHERE id = ?
           AND (lease_until IS NULL OR lease_until <= ? OR locked_by = ?)`,
      )
      .run(workerId, leaseUntil, now, legId, now, workerId);
    return result.changes === 1;
  }

  renewLegLease(legId: string, workerId: string, ttlMs: number): void {
    const now = this.nowSql();
    const result = this.getDb()
      .prepare(
        `UPDATE publish_destination_legs
         SET lease_until = ?, updated_at = ?
         WHERE id = ? AND locked_by = ?`,
      )
      .run(this.dateAfter(ttlMs), now, legId, workerId);
    if (result.changes !== 1) {
      throw new Error(`Publish leg lease is not held by ${workerId}: ${legId}`);
    }
  }

  releaseLegLease(legId: string, workerId: string): void {
    this.getDb()
      .prepare(
        `UPDATE publish_destination_legs
         SET locked_by = NULL, lease_until = NULL, updated_at = ?
         WHERE id = ? AND locked_by = ?`,
      )
      .run(this.nowSql(), legId, workerId);
  }

  async withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.jobLocks.get(jobId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    this.jobLocks.set(jobId, current);

    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.jobLocks.get(jobId) === current) {
        this.jobLocks.delete(jobId);
      }
    }
  }

  listJobs(filter: JobFilter = {}): PublishJob[] {
    return listPublishJobRows(filter, this.getDb()).map((row) =>
      this.inflateJob(row),
    );
  }

  getJob(id: string): PublishJob | null {
    const row = getPublishJobRow(id, this.getDb());
    return row ? this.inflateJob(row) : null;
  }

  getLeg(legId: string): DestinationLegRow | null {
    const row = getPublishDestinationLegRow(legId, this.getDb());
    return row ? this.mapLegRow(row) : null;
  }

  getLegRow(legId: string): PublishDestinationLegRow | null {
    return getPublishDestinationLegRow(legId, this.getDb());
  }

  listLegRows(jobId: string): PublishDestinationLegRow[] {
    return listPublishDestinationLegRows(jobId, this.getDb());
  }

  rescheduleLeg(legId: string, runAt: string): DestinationLegRow {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const row = this.requireLeg(legId, db);
      if (isTerminalLegState(row.state)) {
        throw new Error(`Cannot reschedule terminal publish leg ${legId}`);
      }
      const updated = updatePublishDestinationLegRow(
        legId,
        {
          next_retry_at: runAt,
          updated_at: this.nowSql(),
        },
        db,
      );
      if (!updated) throw new Error(`Publish leg not found: ${legId}`);
      return updated;
    });
    return this.mapLegRow(tx());
  }

  cancelJob(jobId: string): PublishJob {
    const db = this.getDb();
    const tx = db.transaction(() => {
      const job = this.requireJob(jobId, db);
      const now = this.nowSql();
      for (const leg of listPublishDestinationLegRows(jobId, db)) {
        if (isTerminalLegState(leg.state)) continue;
        updatePublishDestinationLegRow(
          leg.id,
          {
            state: 'canceled',
            error_class: 'user_canceled',
            error_message: 'Publish job canceled by user',
            updated_at: now,
          },
          db,
        );
      }
      if (!isTerminalJobState(job.state)) {
        updatePublishJobRow(
          jobId,
          {
            state: 'canceled',
            completed_at: now,
            updated_at: now,
          },
          db,
        );
      }
    });
    tx();
    const row = getPublishJobRow(jobId, db);
    if (!row) throw new Error(`Publish job not found: ${jobId}`);
    return this.inflateJob(row);
  }

  reclaimStalled(): { reclaimed: string[] } {
    const db = this.getDb();
    const rows = db
      .prepare(
        "SELECT * FROM publish_destination_legs WHERE state = 'uploading'",
      )
      .all() as PublishDestinationLegRow[];
    const reclaimed: string[] = [];
    const tx = db.transaction(() => {
      for (const row of rows) {
        if (!isLegStalled(row, this.now().getTime())) continue;
        updatePublishDestinationLegRow(
          row.id,
          {
            state: 'failed',
            error_class: 'stall',
            error_message: 'Upload stalled without chunk progress',
            updated_at: this.nowSql(),
          },
          db,
        );
        this.rollupJobState(row.job_id, db);
        reclaimed.push(row.id);
      }
    });
    tx();
    return { reclaimed };
  }

  private enqueueLegInternal(
    jobId: string,
    leg: DestinationConfig,
    source: SourceArtifact,
    db: Database.Database,
  ): PublishDestinationLegRow {
    const existing = getPublishDestinationLegRowByIdentity(
      jobId,
      leg.kind,
      leg.connectionId,
      db,
    );
    if (existing) return existing;

    const idempotencyKey =
      leg.idempotencyKey ??
      this.createLegIdempotencyKey(jobId, leg.kind, leg.connectionId);

    return insertPublishDestinationLegRow(
      {
        id: crypto.randomUUID(),
        job_id: jobId,
        destination_kind: leg.kind,
        destination_label: leg.label ?? null,
        connection_id: leg.connectionId,
        idempotency_key: idempotencyKey,
        state: 'queued',
        config_json: JSON.stringify(leg),
        total_bytes: source.sizeBytes,
      },
      db,
    );
  }

  private inflateJob(row: PublishJobRow): PublishJob {
    const legs = listPublishDestinationLegRows(row.id, this.getDb());
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      createdBy: row.created_by,
      state: jobStateSchema.parse(row.state),
      source: this.parseSource(row),
      destinations: legs.map((leg) => this.parseDestinationConfig(leg)),
      metadata: this.parseJson<PublishMetadata>(row.metadata_json, {}),
      approval: {
        required: Boolean(row.approval_required),
        channel: row.approval_channel ?? undefined,
      },
      idempotencyKey: row.idempotency_key,
      provenanceState: row.provenance_state,
      signedArtifactPath: row.signed_artifact_path,
      manifestPath: row.manifest_path,
      scheduledFor: row.scheduled_for,
      workflowVersion: row.workflow_version ?? DEFAULT_PUBLISH_WORKFLOW_VERSION,
      workflowState: this.parseJson<Record<string, unknown>>(
        row.workflow_state_json ?? null,
        {},
      ),
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapLegRow(row: PublishDestinationLegRow): DestinationLegRow {
    return {
      ...row,
      destination_kind: destinationKindSchema.parse(row.destination_kind),
      state: legStateSchema.parse(row.state),
    };
  }

  private parseSource(row: PublishJobRow): SourceArtifact {
    return this.parseJson<SourceArtifact>(row.source_json, {
      artifactId: row.artifact_id ?? undefined,
      path: row.source_artifact_path,
      sha256: row.source_sha256,
      sizeBytes: row.source_size_bytes,
      mime: row.source_mime,
      manifestPath: row.manifest_path ?? undefined,
    });
  }

  private parseDestinationConfig(
    row: PublishDestinationLegRow,
  ): DestinationConfig {
    const parsed = this.parseJson<DestinationConfig>(row.config_json, {
      kind: row.destination_kind,
      connectionId: row.connection_id,
      approvalRequired: false,
    });
    return {
      ...parsed,
      kind: destinationKindSchema.parse(parsed.kind),
    };
  }

  private requireJob(jobId: string, db: Database.Database): PublishJobRow {
    const row = getPublishJobRow(jobId, db);
    if (!row) throw new Error(`Publish job not found: ${jobId}`);
    return row;
  }

  private requireLeg(
    legId: string,
    db: Database.Database,
  ): PublishDestinationLegRow {
    const row = getPublishDestinationLegRow(legId, db);
    if (!row) throw new Error(`Publish leg not found: ${legId}`);
    return {
      ...row,
      destination_kind: destinationKindSchema.parse(row.destination_kind),
      state: legStateSchema.parse(row.state),
    };
  }

  private rollupJobState(jobId: string, db: Database.Database): void {
    const job = getPublishJobRow(jobId, db);
    if (!job || job.state === 'failed' || job.state === 'canceled') return;

    const legs = listPublishDestinationLegRows(jobId, db);
    if (!legs.length) return;
    if (legs.every((leg) => leg.state === 'published')) {
      updatePublishJobRow(
        jobId,
        {
          state: 'succeeded',
          completed_at: this.nowSql(),
          updated_at: this.nowSql(),
        },
        db,
      );
      return;
    }

    if (legs.some((leg) => leg.state === 'failed')) {
      updatePublishJobRow(
        jobId,
        {
          state: 'failed',
          completed_at: this.nowSql(),
          updated_at: this.nowSql(),
        },
        db,
      );
    }
  }

  private parseJson<T>(value: string | null, fallback: T): T {
    if (!value) return fallback;
    return JSON.parse(value) as T;
  }

  private createJobIdempotencyKey(input: CreateJobInput): string {
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          workspaceId: input.workspaceId,
          sourceSha256: input.source.sha256,
          destinations: input.destinations.map((leg) => ({
            kind: leg.kind,
            connectionId: leg.connectionId,
            idempotencyKey: leg.idempotencyKey,
          })),
        }),
      )
      .digest('hex');
  }

  private createLegIdempotencyKey(
    jobId: string,
    kind: DestinationKind,
    connectionId: string,
  ): string {
    return crypto
      .createHash('sha256')
      .update(`${jobId}:${kind}:${connectionId}`)
      .digest('hex');
  }

  private getDb(): Database.Database {
    return this.db ?? getDatabase();
  }

  private nowSql(): string {
    return this.now().toISOString();
  }

  private dateAfter(ttlMs: number): string {
    return new Date(this.now().getTime() + ttlMs).toISOString();
  }
}
