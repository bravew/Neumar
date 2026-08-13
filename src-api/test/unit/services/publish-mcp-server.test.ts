import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { migration as migration020 } from '@/shared/db/migrations/020_publish_leg_approvals';
import { runMigrations } from '@/shared/db/migrations/runner';
import {
  createPublishToolHandlers,
  publishTools,
  PUBLISH_TOOL_NAMES,
} from '@/shared/mcp/publish-server';
import { PublishApprovalService } from '@/shared/services/publish/approval';
import { JobLedger } from '@/shared/services/publish/job-ledger';

describe('publish MCP server', () => {
  it('exposes publish lifecycle tools', () => {
    expect(PUBLISH_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'publish.destinations',
        'publish.start',
        'publish.status',
        'publish.approve',
        'publish.session.start',
      ]),
    );
  });

  it('lists publish destinations so agents can resolve connection labels', () => {
    const handlers = createPublishToolHandlers({
      featureEnabled: () => true,
      caller: {
        platform: 'slack',
        permissionTier: 'operator',
        publishScopes: ['publish:immich'],
      },
      listDestinations: () => [
        {
          kind: 'immich',
          connectionId: 'local_immich_1',
          label: 'home album',
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

    expect(handlers.destinations()).toMatchObject({
      items: [
        {
          kind: 'immich',
          connectionId: 'local_immich_1',
          label: 'home album',
        },
      ],
    });
  });

  it('describes publish tools as the writable path for home album labels', () => {
    const descriptions = Object.fromEntries(
      publishTools().map((toolDef) => [toolDef.name, toolDef.description]),
    );

    expect(descriptions['publish.destinations']).toContain('home album');
    expect(descriptions['publish.destinations']).toContain('connectionId');
    expect(descriptions['publish.destinations']).toContain('Google Photos');
    expect(descriptions['publish.start']).toContain('kind "immich"');
    expect(descriptions['publish.start']).toContain('home album');
  });

  it('starts and reads a publish job for scoped agents', () => {
    const fixture = createFixture();
    try {
      const handlers = createPublishToolHandlers({
        ledger: fixture.ledger,
        approvals: fixture.approvals,
        featureEnabled: () => true,
        caller: {
          platform: 'slack',
          permissionTier: 'operator',
          publishScopes: ['publish:local-archive'],
        },
      });

      const started = handlers.start(createJobInput());
      expect(started.jobId).toBeTruthy();
      expect(handlers.status({ jobId: started.jobId })).toMatchObject({
        job: { id: started.jobId },
        legs: [expect.objectContaining({ destinationKind: 'local-archive' })],
      });
    } finally {
      fixture.close();
    }
  });

  it('defaults agent-created Immich jobs to no extra approval', () => {
    const fixture = createFixture();
    try {
      const handlers = createPublishToolHandlers({
        ledger: fixture.ledger,
        approvals: fixture.approvals,
        featureEnabled: () => true,
        caller: { platform: 'desktop', human: true },
      });

      const started = handlers.start({
        workspaceId: 'ws-1',
        createdBy: 'agent:publish',
        source: {
          path: path.join(process.cwd(), 'qr_cropped.jpg'),
          sha256: 'b'.repeat(64),
          sizeBytes: 100,
          mime: 'image/jpeg',
        },
        destinations: [
          {
            kind: 'immich' as const,
            connectionId: 'local_immich_1',
            label: 'home album',
          },
        ],
      });

      expect(handlers.status({ jobId: started.jobId })).toMatchObject({
        job: { state: 'drafted' },
        legs: [
          expect.objectContaining({
            approvalRequired: false,
            destinationKind: 'immich',
          }),
        ],
      });
    } finally {
      fixture.close();
    }
  });

  it('keeps approval tools human-only', () => {
    const fixture = createFixture();
    try {
      const human = createPublishToolHandlers({
        ledger: fixture.ledger,
        approvals: fixture.approvals,
        featureEnabled: () => true,
        caller: { platform: 'desktop', human: true, identityId: 'human:1' },
      });
      const started = human.start(createJobInput());
      const leg = fixture.ledger.listLegRows(started.jobId)[0]!;

      const agent = createPublishToolHandlers({
        ledger: fixture.ledger,
        approvals: fixture.approvals,
        featureEnabled: () => true,
        caller: {
          platform: 'slack',
          permissionTier: 'operator',
          publishScopes: ['publish:local-archive'],
        },
      });

      expect(() => agent.approve({ legId: leg.id })).toThrow(
        /publish_policy_denied/,
      );
      expect(human.approve({ legId: leg.id })).toEqual({
        legId: leg.id,
        approved: true,
        comment: undefined,
      });
    } finally {
      fixture.close();
    }
  });
});

function createFixture() {
  const db = new Database(':memory:');
  runMigrations(db, [migration019, migration020]);
  const ledger = new JobLedger({ db });
  const approvals = new PublishApprovalService({ db });
  return {
    ledger,
    approvals,
    close: () => db.close(),
  };
}

function createJobInput() {
  return {
    workspaceId: 'ws-1',
    createdBy: 'agent:publish',
    source: {
      path: path.join(process.cwd(), 'video.mp4'),
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
      mime: 'video/mp4',
    },
    destinations: [
      {
        kind: 'local-archive' as const,
        connectionId: 'local',
        approvalRequired: true,
      },
    ],
    metadata: { title: 'Launch cut' },
  };
}
