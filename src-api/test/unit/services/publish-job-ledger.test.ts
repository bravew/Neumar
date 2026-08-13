import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { runMigrations } from '@/shared/db/migrations/runner';
import { JobLedger } from '@/shared/services/publish/job-ledger';
import type { CreateJobInput } from '@/shared/services/publish/types';

const source = {
  artifactId: 'artifact-1',
  path: '/workspace/out/video.mp4',
  sha256: 'a'.repeat(64),
  sizeBytes: 2_048_000,
  mime: 'video/mp4',
};

function createDb(filename = ':memory:'): Database.Database {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  runMigrations(db, [migration019]);
  return db;
}

function createJobInput(): CreateJobInput {
  return {
    workspaceId: 'workspace-1',
    createdBy: 'human:user-1',
    source,
    metadata: {
      title: 'Launch video',
      tags: ['launch'],
    },
    destinations: [
      {
        kind: 'local-archive',
        connectionId: 'local',
        approvalRequired: false,
      },
    ],
  };
}

describe('publish job ledger', () => {
  it('creates jobs with legs and persists chunk progress', () => {
    const db = createDb();
    try {
      const ledger = new JobLedger({ db });
      const job = ledger.createJob(createJobInput());
      const leg = ledger.getLeg(
        db
          .prepare('SELECT id FROM publish_destination_legs WHERE job_id = ?')
          .get(job.id)!.id as string,
      );

      expect(job.destinations).toHaveLength(1);
      expect(leg?.state).toBe('queued');
      expect(ledger.listJobs({ workspaceId: 'workspace-1' })).toHaveLength(1);

      ledger.markLegState(leg!.id, 'uploading');
      ledger.recordChunkProgress(leg!.id, 1_048_576, ['etag-1']);

      const updated = ledger.getLeg(leg!.id);
      expect(updated?.chunk_offset_bytes).toBe(1_048_576);
      expect(updated?.etags_json).toBe(JSON.stringify(['etag-1']));
    } finally {
      db.close();
    }
  });

  it('returns the existing leg when enqueueing the same destination twice', () => {
    const db = createDb();
    try {
      const ledger = new JobLedger({ db });
      const job = ledger.createJob({ ...createJobInput(), destinations: [] });

      const leg = {
        kind: 'local-archive' as const,
        connectionId: 'local',
        approvalRequired: false,
      };

      const first = ledger.enqueueLeg(job.id, leg);
      const second = ledger.enqueueLeg(job.id, leg);

      expect(second.id).toBe(first.id);
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM publish_destination_legs')
          .get()!.count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it('recovers stale leases while preserving fresh leases', () => {
    const db = createDb();
    try {
      const ledger = new JobLedger({
        db,
        now: () => new Date('2026-05-06T12:00:00.000Z'),
      });
      const job = ledger.createJob(createJobInput());
      const [leg] = db
        .prepare('SELECT * FROM publish_destination_legs WHERE job_id = ?')
        .all(job.id) as Array<{ id: string }>;

      expect(ledger.acquireLegLease(leg!.id, 'worker-1', 60_000)).toBe(true);
      expect(ledger.acquireLegLease(leg!.id, 'worker-2', 60_000)).toBe(false);

      const laterLedger = new JobLedger({
        db,
        now: () => new Date('2026-05-06T12:02:00.000Z'),
      });
      expect(laterLedger.acquireLegLease(leg!.id, 'worker-2', 60_000)).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });

  it('records notification delivery once', () => {
    const db = createDb();
    try {
      const ledger = new JobLedger({
        db,
        now: () => new Date('2026-05-06T12:00:00.000Z'),
      });
      const job = ledger.createJob(createJobInput());
      const [leg] = db
        .prepare('SELECT * FROM publish_destination_legs WHERE job_id = ?')
        .all(job.id) as Array<{ id: string }>;

      ledger.recordNotificationDelivered(leg!.id, 'channel:first');
      const laterLedger = new JobLedger({
        db,
        now: () => new Date('2026-05-06T12:05:00.000Z'),
      });
      laterLedger.recordNotificationDelivered(leg!.id, 'channel:second');

      const row = db
        .prepare(
          `SELECT notification_channel_ref, notification_delivered_at
           FROM publish_destination_legs WHERE id = ?`,
        )
        .get(leg!.id) as {
        notification_channel_ref: string;
        notification_delivered_at: string;
      };

      expect(row.notification_channel_ref).toBe('channel:first');
      expect(row.notification_delivered_at).toBe('2026-05-06T12:00:00.000Z');
    } finally {
      db.close();
    }
  });

  it('rolls back a mid-transaction failure', () => {
    const db = createDb();
    try {
      const ledger = new JobLedger({ db });
      const job = ledger.createJob(createJobInput());
      const [leg] = db
        .prepare('SELECT * FROM publish_destination_legs WHERE job_id = ?')
        .all(job.id) as Array<{ id: string }>;

      expect(() =>
        ledger.recordPublishedRef(leg!.id, {
          providerId: 'ref-1',
          url: 'file:///archive/ref-1',
        }),
      ).toThrow(/Illegal publish leg transition/);

      const row = db
        .prepare(
          'SELECT state, published_ref_json FROM publish_destination_legs WHERE id = ?',
        )
        .get(leg!.id) as { state: string; published_ref_json: string | null };
      expect(row.state).toBe('queued');
      expect(row.published_ref_json).toBeNull();
    } finally {
      db.close();
    }
  });

  it('moves stalled uploading legs to failed', () => {
    const db = createDb();
    try {
      const ledger = new JobLedger({
        db,
        now: () => new Date('2026-05-06T12:00:00.000Z'),
      });
      const job = ledger.createJob(createJobInput());
      const [leg] = db
        .prepare('SELECT * FROM publish_destination_legs WHERE job_id = ?')
        .all(job.id) as Array<{ id: string }>;
      ledger.markLegState(leg!.id, 'uploading');

      const laterLedger = new JobLedger({
        db,
        now: () => new Date('2026-05-06T12:11:00.000Z'),
      });
      expect(laterLedger.reclaimStalled().reclaimed).toEqual([leg!.id]);

      const row = laterLedger.getLeg(leg!.id);
      expect(row?.state).toBe('failed');
      expect(row?.error_class).toBe('stall');
    } finally {
      db.close();
    }
  });

  it('survives a process restart after chunk progress is written', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-ledger-'));
    const dbPath = path.join(dir, 'ledger.db');
    const childPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../helpers/publish-offset-child.ts',
    );

    try {
      let db = createDb(dbPath);
      const ledger = new JobLedger({ db });
      const job = ledger.createJob(createJobInput());
      const [leg] = db
        .prepare('SELECT * FROM publish_destination_legs WHERE job_id = ?')
        .all(job.id) as Array<{ id: string }>;
      ledger.markLegState(leg!.id, 'uploading');
      db.close();

      execFileSync(
        process.execPath,
        ['--import', 'tsx', childPath, dbPath, leg!.id],
        {
          cwd: path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../../..',
          ),
          stdio: 'pipe',
        },
      );

      db = createDb(dbPath);
      const restartedLedger = new JobLedger({ db });
      expect(restartedLedger.getLeg(leg!.id)?.chunk_offset_bytes).toBe(
        1_048_576,
      );
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
