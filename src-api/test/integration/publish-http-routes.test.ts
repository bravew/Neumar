import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createPublishRoutes } from '@/app/api/publish';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { migration as migration020 } from '@/shared/db/migrations/020_publish_leg_approvals';
import { runMigrations } from '@/shared/db/migrations/runner';
import { PublishApprovalService } from '@/shared/services/publish/approval';
import { JobLedger } from '@/shared/services/publish/job-ledger';

import { jsonReq } from '../helpers/request-factory';

describe('publish HTTP routes', () => {
  it('blocks job creation while the rollout flag is disabled', async () => {
    const fixture = createFixture(false);
    try {
      const res = await fixture.routes.request(
        jsonReq('/jobs', createJobBody()),
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'publish_pipeline_disabled' });
    } finally {
      fixture.close();
    }
  });

  it('creates, lists, approves, streams, and cancels publish jobs', async () => {
    const fixture = createFixture(true);
    try {
      const createRes = await fixture.routes.request(
        jsonReq('/jobs', createJobBody()),
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        job: { id: string; state: string };
        legs: Array<{ id: string; approvalRequired: boolean }>;
      };
      expect(created.job.state).toBe('pending_approval');
      expect(created.legs[0]?.approvalRequired).toBe(true);

      const listRes = await fixture.routes.request('/jobs?workspaceId=ws-1');
      expect(listRes.status).toBe(200);
      expect((await listRes.json()) as unknown).toMatchObject({
        items: [
          expect.objectContaining({
            job: expect.objectContaining({ id: created.job.id }),
          }),
        ],
      });

      const approveRes = await fixture.routes.request(
        jsonReq(`/legs/${created.legs[0]!.id}/approve`, {
          by: 'human:user-1',
        }),
      );
      expect(approveRes.status).toBe(200);
      expect(await approveRes.json()).toMatchObject({
        leg: { approvedBy: 'human:user-1' },
      });

      const eventRes = await fixture.routes.request(
        `/jobs/${created.job.id}/events?once=true`,
      );
      expect(eventRes.status).toBe(200);
      expect(await eventRes.text()).toContain('event: snapshot');

      const cancelRes = await fixture.routes.request(
        `/jobs/${created.job.id}/cancel`,
        { method: 'POST' },
      );
      expect(cancelRes.status).toBe(200);
      expect(await cancelRes.json()).toMatchObject({
        job: { state: 'canceled' },
      });
    } finally {
      fixture.close();
    }
  });

  it('rejects publish sources outside the workspace root', async () => {
    const fixture = createFixture(true);
    try {
      const res = await fixture.routes.request(
        jsonReq('/jobs', {
          ...createJobBody(),
          source: {
            ...createJobBody().source,
            path: path.join(path.dirname(process.cwd()), 'outside.mp4'),
          },
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining('source_path_outside_workspace'),
      });
    } finally {
      fixture.close();
    }
  });

  it('lists connected Immich accounts as publish destinations', async () => {
    const fixture = createFixture(true, {
      listDestinations: () => [
        {
          kind: 'local-archive',
          connectionId: 'local-archive',
          capabilities: {
            supportsResumable: false,
            supportsVersioning: true,
            requiresReformat: false,
            acceptedMimePrefixes: ['image/'],
            approvalDefault: false,
          },
        },
        {
          kind: 'immich',
          connectionId: 'local_immich_1',
          label: 'Home Immich',
          capabilities: {
            supportsResumable: false,
            supportsVersioning: false,
            requiresReformat: false,
            acceptedMimePrefixes: ['image/', 'video/'],
            approvalDefault: false,
          },
        },
      ],
    });
    try {
      const res = await fixture.routes.request('/destinations');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        featureEnabled: true,
        items: [
          { kind: 'local-archive', connectionId: 'local-archive' },
          {
            kind: 'immich',
            connectionId: 'local_immich_1',
            label: 'Home Immich',
          },
        ],
      });
    } finally {
      fixture.close();
    }
  });
});

function createFixture(
  enabled: boolean,
  deps: Partial<NonNullable<Parameters<typeof createPublishRoutes>[0]>> = {},
) {
  const db = new Database(':memory:');
  runMigrations(db, [migration019, migration020]);
  const ledger = new JobLedger({
    db,
    now: () => new Date('2026-05-06T12:00:00.000Z'),
  });
  const approvals = new PublishApprovalService({
    db,
    now: () => new Date('2026-05-06T12:00:00.000Z'),
  });
  return {
    routes: createPublishRoutes({
      ledger,
      approvals,
      featureEnabled: () => enabled,
      ...deps,
    }),
    close: () => db.close(),
  };
}

function createJobBody() {
  return {
    workspaceId: 'ws-1',
    createdBy: 'human:user-1',
    source: {
      path: path.join(process.cwd(), 'video.mp4'),
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
      mime: 'video/mp4',
    },
    destinations: [
      {
        kind: 'local-archive',
        connectionId: 'local',
        approvalRequired: true,
      },
    ],
    metadata: { title: 'Launch cut' },
  };
}
