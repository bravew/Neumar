import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { migration as migration026 } from '@/shared/db/migrations/026_publish_workflows';
import { runMigrations } from '@/shared/db/migrations/runner';
import { JobLedger } from '@/shared/services/publish/job-ledger';
import {
  DEFAULT_PUBLISH_WORKFLOW_VERSION,
  resolvePublishWorkflow,
} from '@/shared/services/publish/workflows';

describe('publish workflow versioning', () => {
  it('stamps new publish jobs with the default workflow version and state', () => {
    const db = new Database(':memory:');
    try {
      runMigrations(db, [migration019, migration026]);
      const ledger = new JobLedger({ db });

      const job = ledger.createJob({
        workspaceId: 'workspace-1',
        createdBy: 'human:user-1',
        source: {
          path: '/workspace/out/post.md',
          sha256: 'a'.repeat(64),
          sizeBytes: 42,
          mime: 'text/markdown',
        },
        destinations: [
          {
            kind: 'local-archive',
            connectionId: 'local',
            approvalRequired: false,
          },
        ],
      });

      expect(job.workflowVersion).toBe(DEFAULT_PUBLISH_WORKFLOW_VERSION);
      expect(job.workflowState).toMatchObject({
        version: DEFAULT_PUBLISH_WORKFLOW_VERSION,
        kind: 'post',
        jobId: job.id,
      });

      const row = db
        .prepare(
          'SELECT workflow_version, workflow_state_json FROM publish_jobs',
        )
        .get() as {
        workflow_version: string;
        workflow_state_json: string;
      };
      expect(row.workflow_version).toBe(DEFAULT_PUBLISH_WORKFLOW_VERSION);
      expect(JSON.parse(row.workflow_state_json)).toMatchObject({
        version: DEFAULT_PUBLISH_WORKFLOW_VERSION,
      });
    } finally {
      db.close();
    }
  });

  it('rejects unknown workflow versions', () => {
    expect(() => resolvePublishWorkflow('9.9.9')).toThrow(
      /Unknown publish workflow version/,
    );
  });
});
