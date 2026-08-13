import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { migration as migration020 } from '@/shared/db/migrations/020_publish_leg_approvals';
import { runMigrations } from '@/shared/db/migrations/runner';
import { JobLedger } from '@/shared/services/publish/job-ledger';
import { PublishOrchestrator } from '@/shared/services/publish/orchestrator';
import { PublishDestinationRegistry } from '@/shared/services/publish/registry';
import { PublishScheduler } from '@/shared/services/publish/scheduler';

import {
  createFakeAdapter,
  createNoopProvenance,
} from './publish-restart-support';

describe('publish restart resume', () => {
  it('finishes a queued leg after reopening the ledger database', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-restart-'));
    const dbPath = path.join(dir, 'publish.db');
    try {
      const sourcePath = path.join(process.cwd(), 'video.mp4');
      let db = openDb(dbPath);
      let ledger = new JobLedger({ db });
      const job = ledger.createJob({
        workspaceId: 'workspace-1',
        createdBy: 'human:user-1',
        source: {
          path: sourcePath,
          sha256: 'b'.repeat(64),
          sizeBytes: 10,
          mime: 'video/mp4',
        },
        destinations: [
          {
            kind: 'local-archive',
            connectionId: 'local',
            approvalRequired: false,
          },
        ],
      });
      db.close();

      db = openDb(dbPath);
      ledger = new JobLedger({ db });
      const registry = new PublishDestinationRegistry();
      registry.register(createFakeAdapter('local-archive'));
      const orchestrator = new PublishOrchestrator({
        ledger,
        registry,
        scheduler: new PublishScheduler({ db }),
        provenance: createNoopProvenance(sourcePath),
      });

      await orchestrator.tick();

      expect(ledger.getJob(job.id)?.state).toBe('succeeded');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  runMigrations(db, [migration019, migration020]);
  return db;
}
