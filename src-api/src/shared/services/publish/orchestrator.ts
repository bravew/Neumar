import type { PublishDestinationLegRow } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

import { PublishApprovalService } from './approval';
import { JobLedger } from './job-ledger';
import { publishResourceLocks, type ResourceLockManager } from './lease';
import { PublishProvenanceService } from './provenance';
import type { QuotaSpec } from './quota-specs';
import { QuotaTracker } from './quota-tracker';
import {
  publishDestinationRegistry,
  type PublishDestinationRegistry,
} from './registry';
import { classifyPublishError } from './retry-policy';
import { PublishScheduler } from './scheduler';
import {
  isPublishSourcePathAllowed,
  resolvePublishSourcePath,
} from './source-path-policy';
import type {
  DestinationCapabilities,
  PublishedRef,
  PublishDestinationAdapter,
  PublishLegInput,
  SourceArtifact,
} from './types';
import { resolvePublishWorkflow } from './workflows';

export const WORKER_TICK_MS = Number(
  process.env.PUBLISH_WORKER_TICK_MS ?? 1000,
);
export const LEG_LIFETIME_CAP_MS = 7 * 24 * 60 * 60 * 1000;
const logger = createLogger('PublishOrchestrator');

export interface PublishOrchestratorDeps {
  ledger?: JobLedger;
  registry?: PublishDestinationRegistry;
  scheduler?: PublishScheduler;
  approvals?: PublishApprovalService;
  quotaTracker?: QuotaTracker;
  provenance?: Pick<PublishProvenanceService, 'signOnce'>;
  locks?: ResourceLockManager;
  now?: () => Date;
  workerId?: string;
  leaseMs?: number;
  maxPerTick?: number;
}

export class PublishOrchestrator {
  private readonly ledger: JobLedger;
  private readonly registry: PublishDestinationRegistry;
  private readonly scheduler: PublishScheduler;
  private readonly approvals: PublishApprovalService;
  private readonly quotaTracker: QuotaTracker;
  private readonly provenance: Pick<PublishProvenanceService, 'signOnce'>;
  private readonly locks: ResourceLockManager;
  private readonly now: () => Date;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly maxPerTick: number;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(deps: PublishOrchestratorDeps = {}) {
    this.ledger = deps.ledger ?? new JobLedger();
    this.registry = deps.registry ?? publishDestinationRegistry;
    this.scheduler = deps.scheduler ?? new PublishScheduler();
    this.approvals = deps.approvals ?? new PublishApprovalService();
    this.quotaTracker = deps.quotaTracker ?? new QuotaTracker();
    this.provenance =
      deps.provenance ?? new PublishProvenanceService({ ledger: this.ledger });
    this.locks = deps.locks ?? publishResourceLocks;
    this.now = deps.now ?? (() => new Date());
    this.workerId = deps.workerId ?? `publish-worker:${process.pid}`;
    this.leaseMs = deps.leaseMs ?? 60_000;
    this.maxPerTick = deps.maxPerTick ?? 10;
  }

  start(): void {
    if (this.timer) return;
    this.ledger.reclaimStalled();
    this.stopping = false;
    this.timer = setInterval(() => void this.tick(), WORKER_TICK_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ processed: string[]; deferred: string[] }> {
    if (this.stopping) return { processed: [], deferred: [] };
    const processed: string[] = [];
    const deferred: string[] = [];
    const activeByBucket = new Map<string, number>();

    for (const row of this.scheduler.listReadyQueuedLegs(this.maxPerTick)) {
      if (this.expireIfTooOld(row)) {
        deferred.push(row.id);
        continue;
      }
      if (!this.registry.has(row.destination_kind)) {
        // A queued leg targets a destination kind the registry doesn't know
        // about (e.g. an old job from a previous build, or a destination
        // that's been removed). Fail the leg permanently so the worker
        // stops trying it every tick.
        this.ledger.markLegState(row.id, 'failed', {
          error_class: 'no_adapter_registered',
          error_message: `No publish destination adapter registered for ${row.destination_kind}`,
        });
        deferred.push(row.id);
        continue;
      }
      const adapter = this.registry.resolve(row.destination_kind);
      const bucket = concurrencyBucket(adapter.capabilities());
      const cap = concurrencyCap(adapter.capabilities());
      const active = activeByBucket.get(bucket) ?? 0;
      if (active >= cap) {
        deferred.push(row.id);
        continue;
      }
      if (!this.approvals.canRun(row)) {
        this.approvals.requestApproval(row.id);
        deferred.push(row.id);
        continue;
      }
      const quota = this.quotaTracker.canConsume(
        row.connection_id,
        quotaSpecs(adapter.capabilities()),
      );
      if (!quota.ok) {
        this.ledger.markLegState(row.id, 'queued', {
          error_class: 'quota_exhausted',
          error_message: quota.reason ?? 'Quota exhausted',
          next_retry_at: quota.retryAt?.toISOString(),
        });
        deferred.push(row.id);
        continue;
      }
      activeByBucket.set(bucket, active + 1);
      await this.locks.withResourceLock(row.id, async () => {
        await this.processLeg(row, adapter);
        processed.push(row.id);
      });
    }

    return { processed, deferred };
  }

  private async processLeg(
    row: PublishDestinationLegRow,
    adapter: PublishDestinationAdapter,
  ): Promise<void> {
    if (!this.ledger.acquireLegLease(row.id, this.workerId, this.leaseMs)) {
      return;
    }
    try {
      const job = this.ledger.getJob(row.job_id);
      if (!job) throw new Error(`Publish job not found: ${row.job_id}`);
      const workflow = resolvePublishWorkflow(job.workflowVersion);
      logger.debug('publish.workflow.resolved', {
        jobId: job.id,
        workflowVersion: workflow.version,
      });
      const destination = job.destinations.find(
        (candidate) =>
          candidate.kind === row.destination_kind &&
          candidate.connectionId === row.connection_id,
      );
      if (!destination) {
        throw new Error(`Publish destination config not found: ${row.id}`);
      }
      const source = this.normalizeSourcePath(
        await this.signedSource(job.source, row.job_id),
      );
      const input: PublishLegInput = {
        jobId: row.job_id,
        legId: row.id,
        source,
        metadata: job.metadata,
        destination,
      };
      const plan = await adapter.plan(input);
      this.ledger.recordLegPlan(row.id, plan);
      this.quotaTracker.recordConsumption(
        row.connection_id,
        quotaSpecs(adapter.capabilities()),
      );
      this.ledger.markLegState(row.id, 'uploading');
      const ctx = {
        recordChunkProgress: (offset: number, etags?: string[]) =>
          this.ledger.recordChunkProgress(row.id, offset, etags),
      };
      const handle = await adapter.upload(input, ctx);
      this.ledger.markLegState(row.id, 'uploaded', {
        session_id: handle.sessionId,
        total_bytes: handle.offsetBytes,
      });
      this.ledger.markLegState(row.id, 'finalizing');
      const ref = await adapter.finalize(handle, ctx);
      const status = await adapter.queryStatus(ref);
      if (status.state === 'failed') {
        this.ledger.markLegState(row.id, 'failed', {
          error_class: 'provider_failed',
          error_message: status.message ?? 'Provider reported failure',
        });
        return;
      }
      this.ledger.recordPublishedRef(row.id, mergeStatus(ref, status.metadata));
    } catch (error) {
      const classified = classifyPublishError(error);
      this.ledger.markLegState(row.id, 'failed', {
        error_class: classified.class,
        error_message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ledger.releaseLegLease(row.id, this.workerId);
    }
  }

  private async signedSource(
    source: SourceArtifact,
    jobId: string,
  ): Promise<SourceArtifact> {
    try {
      const signed = await this.provenance.signOnce(jobId);
      return {
        ...source,
        path: signed.signedArtifactPath,
        manifestPath: signed.manifestPath,
      };
    } catch (error) {
      logger.warn('C2PA signing failed, publishing original source', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      return source;
    }
  }

  private normalizeSourcePath(source: SourceArtifact): SourceArtifact {
    const normalizedPath = resolvePublishSourcePath(source.path);
    if (!isPublishSourcePathAllowed(normalizedPath)) {
      throw new Error('source_path_outside_workspace');
    }
    const manifestPath = source.manifestPath
      ? resolvePublishSourcePath(source.manifestPath)
      : undefined;
    if (manifestPath && !isPublishSourcePathAllowed(manifestPath)) {
      throw new Error('source_manifest_path_outside_workspace');
    }
    return {
      ...source,
      path: normalizedPath,
      manifestPath,
    };
  }

  private expireIfTooOld(row: PublishDestinationLegRow): boolean {
    if (
      this.now().getTime() - Date.parse(row.created_at) <
      LEG_LIFETIME_CAP_MS
    ) {
      return false;
    }
    this.ledger.markLegState(row.id, 'failed', {
      error_class: 'lifetime_exceeded',
      error_message: 'Publish leg exceeded lifetime cap',
    });
    return true;
  }
}

let singleton: PublishOrchestrator | null = null;

export function getPublishOrchestrator(): PublishOrchestrator {
  singleton ??= new PublishOrchestrator();
  return singleton;
}

function quotaSpecs(capabilities: DestinationCapabilities): QuotaSpec[] {
  return (capabilities.quota ?? []).map((quota) => ({
    kind: quota.kind,
    cost: quota.cost,
    window: quotaWindowFromMs(quota.windowMs),
    limit: (quota as { limit?: number }).limit,
  }));
}

function quotaWindowFromMs(windowMs?: number): QuotaSpec['window'] {
  if (windowMs === 60 * 60 * 1000) return '1h';
  if (windowMs === 30 * 24 * 60 * 60 * 1000) return '30d';
  return '24h';
}

function concurrencyBucket(capabilities: DestinationCapabilities): string {
  if (capabilities.approvalDefault) return 'approval-default';
  if (capabilities.supportsResumable) return 'resumable';
  return 'local';
}

function concurrencyCap(capabilities: DestinationCapabilities): number {
  if (capabilities.approvalDefault) return 1;
  if (capabilities.supportsResumable) return 2;
  return Number.POSITIVE_INFINITY;
}

function mergeStatus(
  ref: PublishedRef,
  metadata?: Record<string, unknown>,
): PublishedRef {
  return metadata
    ? { ...ref, metadata: { ...(ref.metadata ?? {}), status: metadata } }
    : ref;
}
