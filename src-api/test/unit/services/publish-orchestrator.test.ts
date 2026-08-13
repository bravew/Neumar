import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { migration as migration020 } from '@/shared/db/migrations/020_publish_leg_approvals';
import { runMigrations } from '@/shared/db/migrations/runner';
import { PublishApprovalService } from '@/shared/services/publish/approval';
import { JobLedger } from '@/shared/services/publish/job-ledger';
import { PublishOrchestrator } from '@/shared/services/publish/orchestrator';
import type { PublishOrchestratorDeps } from '@/shared/services/publish/orchestrator';
import { QuotaTracker } from '@/shared/services/publish/quota-tracker';
import { PublishDestinationRegistry } from '@/shared/services/publish/registry';
import { PublishScheduler } from '@/shared/services/publish/scheduler';
import type {
  DestinationCapabilities,
  DestinationKind,
  LegContext,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  UploadHandle,
} from '@/shared/services/publish/types';

describe('publish orchestrator', () => {
  it('blocks only approval-required legs', async () => {
    const fixture = createFixture();
    try {
      const approvalAdapter = new FakeAdapter('gdrive', {
        approvalDefault: true,
      });
      const openAdapter = new FakeAdapter('local-archive');
      const orchestrator = createOrchestrator(fixture, [
        approvalAdapter,
        openAdapter,
      ]);
      const job = fixture.ledger.createJob({
        workspaceId: 'workspace-1',
        createdBy: 'human:user-1',
        source: fixture.source,
        destinations: [
          { kind: 'gdrive', connectionId: 'social', approvalRequired: true },
          {
            kind: 'local-archive',
            connectionId: 'local',
            approvalRequired: false,
          },
        ],
      });

      const first = await orchestrator.tick();
      const rows = fixture.db
        .prepare(
          'SELECT id, destination_kind, state FROM publish_destination_legs',
        )
        .all() as Array<{
        id: string;
        destination_kind: string;
        state: string;
      }>;
      const approvalLeg = rows.find(
        (row) => row.destination_kind === 'gdrive',
      )!;
      const openLeg = rows.find(
        (row) => row.destination_kind === 'local-archive',
      )!;

      expect(first.processed).toEqual([openLeg.id]);
      expect(first.deferred).toContain(approvalLeg.id);
      expect(fixture.ledger.getLeg(openLeg.id)?.state).toBe('published');
      expect(fixture.ledger.getLeg(approvalLeg.id)?.state).toBe('queued');

      fixture.approvals.approveLeg(approvalLeg.id, 'user-1');
      const second = await orchestrator.tick();

      expect(second.processed).toEqual([approvalLeg.id]);
      expect(fixture.ledger.getJob(job.id)?.state).toBe('succeeded');
    } finally {
      fixture.close();
    }
  });

  it('defers quota-exhausted legs until the window rolls', async () => {
    const fixture = createFixture();
    try {
      const adapter = new FakeAdapter('box', {
        quota: [
          {
            kind: 'box_units',
            cost: 1,
            windowMs: 24 * 60 * 60 * 1000,
            limit: 0,
          },
        ],
      });
      const orchestrator = createOrchestrator(fixture, [adapter]);
      fixture.ledger.createJob({
        workspaceId: 'workspace-1',
        createdBy: 'human:user-1',
        source: fixture.source,
        destinations: [
          { kind: 'box', connectionId: 'box-conn', approvalRequired: false },
        ],
      });

      const result = await orchestrator.tick();
      const row = fixture.db
        .prepare(
          'SELECT id, state, error_class, next_retry_at FROM publish_destination_legs',
        )
        .get() as {
        id: string;
        state: string;
        error_class: string | null;
        next_retry_at: string | null;
      };

      expect(result.processed).toEqual([]);
      expect(result.deferred).toEqual([row.id]);
      expect(row.state).toBe('queued');
      expect(row.error_class).toBe('quota_exhausted');
      expect(row.next_retry_at).toBe('2026-05-07T00:00:00.000Z');
    } finally {
      fixture.close();
    }
  });

  it('defers monthly quota-exhausted legs until the 30-day window rolls', async () => {
    const fixture = createFixtureAt(new Date('2026-05-08T12:00:00.000Z'));
    try {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const adapter = new FakeAdapter('box', {
        quota: [
          {
            kind: 'box_monthly_units',
            cost: 1,
            windowMs: thirtyDaysMs,
            limit: 0,
          },
        ],
      });
      const orchestrator = createOrchestrator(fixture, [adapter]);
      fixture.ledger.createJob({
        workspaceId: 'workspace-1',
        createdBy: 'human:user-1',
        source: fixture.source,
        destinations: [
          { kind: 'box', connectionId: 'box-conn', approvalRequired: false },
        ],
      });

      await orchestrator.tick();
      const row = fixture.db
        .prepare('SELECT next_retry_at FROM publish_destination_legs')
        .get() as { next_retry_at: string | null };
      const now = fixture.now().getTime();
      const nextWindow = new Date(
        (Math.floor(now / thirtyDaysMs) + 1) * thirtyDaysMs,
      ).toISOString();

      expect(row.next_retry_at).toBe(nextWindow);
      expect(row.next_retry_at).not.toBe('2026-05-07T00:00:00.000Z');
    } finally {
      fixture.close();
    }
  });

  it('uploads the original source when provenance signing fails', async () => {
    const fixture = createFixture();
    try {
      const adapter = new FakeAdapter('immich');
      const orchestrator = createOrchestrator(fixture, [adapter], {
        signOnce: async () => {
          throw new Error('C2PA signer rejected test credentials');
        },
      });
      const job = fixture.ledger.createJob({
        workspaceId: 'workspace-1',
        createdBy: 'human:user-1',
        source: fixture.source,
        destinations: [
          {
            kind: 'immich',
            connectionId: 'home-album',
            approvalRequired: false,
          },
        ],
      });

      const result = await orchestrator.tick();

      expect(result.processed).toHaveLength(1);
      expect(adapter.uploads).toHaveLength(1);
      expect(adapter.uploads[0]?.source).toEqual(fixture.source);
      expect(fixture.ledger.getJob(job.id)?.state).toBe('succeeded');
    } finally {
      fixture.close();
    }
  });
});

class FakeAdapter implements PublishDestinationAdapter {
  readonly uploads: PublishLegInput[] = [];
  readonly kind: DestinationKind;

  constructor(
    kind: DestinationKind,
    private readonly capabilityOverrides: Partial<DestinationCapabilities> = {},
  ) {
    this.kind = kind;
  }

  capabilities(): DestinationCapabilities {
    return {
      supportsResumable: false,
      supportsVersioning: false,
      requiresReformat: false,
      acceptedMimePrefixes: ['video/'],
      approvalDefault: false,
      ...this.capabilityOverrides,
    };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    return {
      destinationKind: this.kind,
      uploadBytes: input.source.sizeBytes,
      requiresApproval: input.destination.approvalRequired,
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    this.uploads.push(input);
    ctx.recordChunkProgress(input.source.sizeBytes);
    return {
      sessionId: `${this.kind}:session`,
      offsetBytes: input.source.sizeBytes,
    };
  }

  async finalize(): Promise<PublishedRef> {
    return { providerId: `${this.kind}:published` };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }

  async abort(): Promise<void> {
    return;
  }
}

function createFixture(): {
  db: Database.Database;
  ledger: JobLedger;
  approvals: PublishApprovalService;
  source: PublishLegInput['source'];
  now: () => Date;
  close(): void;
} {
  const nowDate = new Date('2026-05-06T12:00:00.000Z');
  return createFixtureAt(nowDate);
}

function createFixtureAt(nowDate: Date): {
  db: Database.Database;
  ledger: JobLedger;
  approvals: PublishApprovalService;
  source: PublishLegInput['source'];
  now: () => Date;
  close(): void;
} {
  const db = new Database(':memory:');
  runMigrations(db, [migration019, migration020]);
  const source = {
    path: path.join(process.cwd(), 'video.mp4'),
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
    mime: 'video/mp4',
  };
  const now = () => new Date(nowDate);
  return {
    db,
    ledger: new JobLedger({ db, now }),
    approvals: new PublishApprovalService({ db, now }),
    source,
    now,
    close() {
      db.close();
    },
  };
}

function createOrchestrator(
  fixture: ReturnType<typeof createFixture>,
  adapters: PublishDestinationAdapter[],
  provenance: PublishOrchestratorDeps['provenance'] = {
    signOnce: async () => ({
      signedArtifactPath: fixture.source.path,
      manifestPath: path.join(process.cwd(), 'manifest.c2pa.json'),
      manifestSha256: 'm'.repeat(64),
      contentSha256: fixture.source.sha256,
      embedded: true,
      signerMode: 'local-test',
      runner: {
        sdkPackage: '@contentauth/c2pa-node',
        sdkVersion: '0.5.5',
        specVersion: '2.4',
      },
    }),
  },
): PublishOrchestrator {
  const registry = new PublishDestinationRegistry();
  for (const adapter of adapters) registry.register(adapter);
  return new PublishOrchestrator({
    ledger: fixture.ledger,
    approvals: fixture.approvals,
    registry,
    scheduler: new PublishScheduler({
      db: fixture.db,
      now: fixture.now,
    }),
    quotaTracker: new QuotaTracker({
      db: fixture.db,
      now: fixture.now,
    }),
    provenance,
  });
}
