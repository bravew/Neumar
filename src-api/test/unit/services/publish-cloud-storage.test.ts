import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { runMigrations } from '@/shared/db/migrations/runner';
import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import { S3CompatibleAdapter } from '@/shared/integrations/cloud-storage/providers/s3-compatible';
import type {
  Capabilities,
  CloudFile,
  CloudStorageProvider,
  UploadInput,
} from '@/shared/integrations/cloud-storage/types';
import { CloudStorageDestination } from '@/shared/services/publish/destinations/cloud-storage-destination';
import { ImmichPublishDestination } from '@/shared/services/publish/destinations/immich-destination';
import { LocalArchiveAdapter } from '@/shared/services/publish/destinations/local-archive';
import { JobLedger } from '@/shared/services/publish/job-ledger';

const sha = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

const noCapabilities: Capabilities = {
  fullTextSearch: false,
  thumbnails: false,
  exportContent: false,
  watch: false,
  longPoll: false,
  sharedDrives: false,
};

function cloudFile(input: Partial<CloudFile> = {}): CloudFile {
  const now = '2026-05-06T12:00:00.000Z';
  return {
    id: input.id ?? 'file-1',
    name: input.name ?? 'video.mp4',
    path: input.path,
    mimeType: input.mimeType ?? 'video/mp4',
    size: input.size ?? 5,
    createdAt: input.createdAt ?? now,
    modifiedAt: input.modifiedAt ?? now,
    parentId: input.parentId ?? null,
    isFolder: input.isFolder ?? false,
    provider: input.provider ?? 'google_drive',
    webUrl: input.webUrl ?? 'https://cloud.example/file-1',
    revision: input.revision ?? 'rev-1',
    etag: input.etag,
  };
}

class FakeCloudAdapter implements CloudStorageAdapter {
  readonly uploads: UploadInput[] = [];

  constructor(readonly provider: CloudStorageProvider = 'google_drive') {}

  getCapabilities(): Capabilities {
    return noCapabilities;
  }

  async upload(input: UploadInput): Promise<CloudFile> {
    this.uploads.push(input);
    return cloudFile({
      name: input.name,
      provider: this.provider,
      revision: `rev-${this.uploads.length}`,
    });
  }

  listChildren(): never {
    throw new Error('not implemented');
  }
  search(): never {
    throw new Error('not implemented');
  }
  getMetadata(): never {
    throw new Error('not implemented');
  }
  download(): never {
    throw new Error('not implemented');
  }
  exportContent(): never {
    throw new Error('not implemented');
  }
  createFolder(): never {
    throw new Error('not implemented');
  }
  updateMetadata(): never {
    throw new Error('not implemented');
  }
  move(): never {
    throw new Error('not implemented');
  }
  copy(): never {
    throw new Error('not implemented');
  }
  delete(): never {
    throw new Error('not implemented');
  }
  getChanges(): never {
    throw new Error('not implemented');
  }
}

describe('publish cloud storage destination', () => {
  it('plans versioned paths, uploads through CloudStorageAdapter, and records leg plan', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-cloud-'));
    const db = new Database(':memory:');
    try {
      runMigrations(db, [migration019]);
      const sourcePath = path.join(dir, 'video.mp4');
      writeFileSync(sourcePath, 'hello');
      const adapter = new FakeCloudAdapter();
      const destination = new CloudStorageDestination({
        kind: 'gdrive',
        connectionId: 'conn-1',
        adapter,
        capabilities: { supportsVersioning: true },
      });
      const ledger = new JobLedger({ db });
      const job = ledger.createJob({
        workspaceId: 'workspace-1',
        createdBy: 'human:user-1',
        source: {
          path: sourcePath,
          sha256: sha,
          sizeBytes: 5,
          mime: 'video/mp4',
        },
        metadata: { title: 'video.mp4' },
        destinations: [
          { kind: 'gdrive', connectionId: 'conn-1', approvalRequired: false },
        ],
      });
      const legId = (
        db.prepare('SELECT id FROM publish_destination_legs').get() as {
          id: string;
        }
      ).id;

      const input = {
        jobId: job.id,
        legId,
        source: job.source,
        metadata: job.metadata,
        destination: job.destinations[0]!,
      };
      const plan = await destination.plan(input);
      ledger.recordLegPlan(legId, plan);
      const handle = await destination.upload(input, {
        recordChunkProgress: vi.fn(),
      });

      expect(plan.targetPath).toBe('video_abcdef12.mp4');
      expect(adapter.uploads[0]?.name).toBe('video_abcdef12.mp4');
      await expect(destination.finalize(handle)).resolves.toMatchObject({
        providerId: 'file-1',
        revision: 'rev-1',
      });
      expect(
        (
          db
            .prepare('SELECT plan_json FROM publish_destination_legs')
            .get() as {
            plan_json: string;
          }
        ).plan_json,
      ).toContain('video_abcdef12.mp4');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects oversized files before reading upload content', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-cloud-size-'));
    try {
      const sourcePath = path.join(dir, 'large.mp4');
      writeFileSync(sourcePath, 'too-large');
      const adapter = new FakeCloudAdapter();
      const destination = new CloudStorageDestination({
        kind: 'gdrive',
        connectionId: 'conn-1',
        adapter,
        capabilities: { maxBytes: 4 },
      });
      const input = {
        jobId: 'job-1',
        legId: 'leg-1',
        source: {
          path: sourcePath,
          sha256: sha,
          sizeBytes: 9,
          mime: 'video/mp4',
        },
        metadata: { title: 'large.mp4' },
        destination: {
          kind: 'gdrive' as const,
          connectionId: 'conn-1',
          approvalRequired: false,
        },
      };

      await expect(
        destination.upload(input, { recordChunkProgress: vi.fn() }),
      ).rejects.toThrow(/publish_source_exceeds_destination_max_bytes/);
      expect(adapter.uploads).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('short-circuits already-current cloud files', async () => {
    const adapter = new FakeCloudAdapter();
    const destination = new CloudStorageDestination({
      kind: 'dropbox',
      connectionId: 'conn-1',
      adapter,
      findExisting: async () =>
        cloudFile({ id: 'existing', revision: 'rev-old' }),
    });
    const input = {
      jobId: 'job-1',
      legId: 'leg-1',
      source: {
        path: '/tmp/video.mp4',
        sha256: sha,
        sizeBytes: 5,
        mime: 'video/mp4',
      },
      metadata: { title: 'video.mp4' },
      destination: {
        kind: 'dropbox' as const,
        connectionId: 'conn-1',
        approvalRequired: false,
      },
    };

    const plan = await destination.plan(input);
    const progress = vi.fn();
    const handle = await destination.upload(input, {
      recordChunkProgress: progress,
    });

    expect(plan.alreadyCurrent).toBe(true);
    expect(adapter.uploads).toHaveLength(0);
    expect(progress).toHaveBeenCalledWith(0);
    await expect(destination.finalize(handle)).resolves.toMatchObject({
      providerId: 'existing',
      metadata: { note: 'already-current' },
    });
  });

  it('publishes to a transport-backed S3-compatible adapter', async () => {
    const putObject = vi.fn(async () => ({
      key: 'exports/video.mp4',
      etag: 'etag-1',
      versionId: 'version-1',
      url: 'https://r2.example/exports/video.mp4',
    }));
    const adapter = new S3CompatibleAdapter({
      bucket: 'bucket',
      baseUrl: 'https://r2.example',
      versioningEnabled: true,
      transport: { putObject },
    });

    const uploaded = await adapter.upload({
      parentId: 'exports',
      name: 'video.mp4',
      content: new Blob(['hello']),
      mimeType: 'video/mp4',
      metadata: { sha256: sha },
    });

    expect(uploaded.provider).toBe('s3_compatible');
    expect(uploaded.revision).toBe('version-1');
    expect(putObject).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'exports/video.mp4' }),
    );
  });

  it('publishes edited images to Immich as new assets', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-immich-'));
    try {
      const sourcePath = path.join(dir, 'edited.jpg');
      writeFileSync(sourcePath, 'edited image bytes');
      const adapter = new FakeCloudAdapter('immich');
      const destination = new ImmichPublishDestination({
        resolveAdapter: () => adapter,
        ensureConnectionsCached: vi.fn(),
      });
      const input = {
        jobId: 'job-1',
        legId: 'leg-1',
        source: {
          path: sourcePath,
          sha256: sha,
          sizeBytes: 18,
          mime: 'image/jpeg',
        },
        metadata: { title: 'edited.jpg' },
        destination: {
          kind: 'immich' as const,
          connectionId: 'local_immich_1',
          approvalRequired: false,
        },
      };

      const plan = await destination.plan(input);
      const handle = await destination.upload(input, {
        recordChunkProgress: vi.fn(),
      });
      const ref = await destination.finalize(handle);

      expect(destination.capabilities().acceptedMimePrefixes).toContain(
        'image/',
      );
      expect(plan.targetPath).toBe('edited_abcdef12.jpg');
      expect(adapter.uploads).toHaveLength(1);
      expect(adapter.uploads[0]).toMatchObject({
        name: 'edited_abcdef12.jpg',
        mimeType: 'image/jpeg',
        overwrite: false,
        metadata: {
          sha256: sha,
          publishJobId: 'job-1',
          publishLegId: 'leg-1',
        },
      });
      expect(ref).toMatchObject({
        providerId: 'file-1',
        revision: 'rev-1',
        metadata: { provider: 'immich' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes local archive bytes and sidecars', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-archive-'));
    try {
      const sourcePath = path.join(dir, 'video.mp4');
      writeFileSync(sourcePath, 'hello');
      const indexFile = vi.fn(async () => undefined);
      const adapter = new LocalArchiveAdapter({
        rootDir: path.join(dir, 'archive'),
        now: () => new Date('2026-05-06T12:00:00.000Z'),
        indexFile,
      });

      const handle = await adapter.upload(
        {
          jobId: 'job-1',
          legId: 'leg-1',
          source: {
            path: sourcePath,
            sha256: sha,
            sizeBytes: 5,
            mime: 'video/mp4',
          },
          metadata: { title: 'Launch Video' },
          destination: {
            kind: 'local-archive',
            connectionId: 'local',
            approvalRequired: false,
          },
        },
        { recordChunkProgress: vi.fn() },
      );
      const ref = await adapter.finalize(handle);
      const artifactPath = ref.metadata?.artifactPath as string;

      expect(readFileSync(artifactPath, 'utf8')).toBe('hello');
      expect(
        existsSync(path.join(path.dirname(artifactPath), 'publish.json')),
      ).toBe(true);
      expect(indexFile).toHaveBeenCalledWith(artifactPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
