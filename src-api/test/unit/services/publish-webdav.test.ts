import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import { RcloneBridge } from '@/shared/integrations/storage/rclone-bridge';
import { SynologyPhotosClient } from '@/shared/integrations/storage/synology-photos';
import { WebDavClient } from '@/shared/integrations/storage/webdav';
import { RcloneDestination } from '@/shared/services/publish/destinations/rclone-destination';
import { SynologyPhotosDestination } from '@/shared/services/publish/destinations/synology-photos-destination';
import { WebDavDestination } from '@/shared/services/publish/destinations/webdav-destination';

const sha = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

function sourceFixture(): { dir: string; sourcePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'publish-webdav-'));
  const sourcePath = path.join(dir, 'video.mp4');
  writeFileSync(sourcePath, 'hello');
  return { dir, sourcePath };
}

describe('publish WebDAV and self-hosted destinations', () => {
  it('uses temp PUT plus MOVE and snapshots existing WebDAV targets', async () => {
    const { dir, sourcePath } = sourceFixture();
    const calls: Array<{ url: string; method: string; destination?: string }> =
      [];
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({
          url: String(input),
          method,
          destination:
            new Headers(init?.headers).get('Destination') ?? undefined,
        });
        if (method === 'HEAD') return new Response(null, { status: 200 });
        if (method === 'MKCOL') return new Response(null, { status: 201 });
        if (method === 'PUT') return new Response(null, { status: 201 });
        if (method === 'MOVE') return new Response(null, { status: 201 });
        return new Response(null, { status: 500 });
      },
    );

    try {
      const destination = new WebDavDestination({
        client: new WebDavClient({
          baseUrl: 'https://nas.example/dav',
          fetch,
        }),
        defaultVersioning: {
          mode: 'timestamped-folder',
          timestampedFolder: { rootPath: '_versions', tsFormat: 'epoch' },
        },
      });

      const handle = await destination.upload(
        {
          jobId: 'job-1',
          legId: 'leg-1',
          source: {
            path: sourcePath,
            sha256: sha,
            sizeBytes: 5,
            mime: 'video/mp4',
          },
          metadata: { title: 'Backup/Neuma/video.mp4' },
          destination: {
            kind: 'webdav',
            connectionId: 'webdav-1',
            approvalRequired: false,
          },
        },
        { recordChunkProgress: vi.fn() },
      );
      const ref = await destination.finalize(handle);

      expect(ref.providerId).toBe('Backup/Neuma/video.mp4');
      expect(calls.filter((call) => call.method === 'MOVE')).toHaveLength(2);
      expect(
        calls.some((call) => call.destination?.includes('_versions')),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects provider-native versioning for generic WebDAV', async () => {
    const destination = new WebDavDestination({
      client: new WebDavClient({
        baseUrl: 'https://nas.example/dav',
        fetch: vi.fn(),
      }),
    });

    await expect(
      destination.plan({
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
          kind: 'webdav',
          connectionId: 'webdav-1',
          approvalRequired: false,
          versioning: { mode: 'provider-native' },
        },
      }),
    ).rejects.toThrow(/provider-native/);
  });

  it('refreshes Synology SID on upload auth rotation', async () => {
    const { dir, sourcePath } = sourceFixture();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { sid: 'sid-1' } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 119 } }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { sid: 'sid-2' } })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { id: 'photo-1' } }),
        ),
      );

    try {
      const destination = new SynologyPhotosDestination(
        new SynologyPhotosClient({
          baseUrl: 'https://synology.example',
          username: 'user',
          password: 'pass',
          fetch,
        }),
      );
      const handle = await destination.upload(
        {
          jobId: 'job-1',
          legId: 'leg-1',
          source: {
            path: sourcePath,
            sha256: sha,
            sizeBytes: 5,
            mime: 'video/mp4',
          },
          metadata: { title: 'video.mp4' },
          destination: {
            kind: 'synology-photos',
            connectionId: 'synology-1',
            approvalRequired: false,
          },
        },
        { recordChunkProgress: vi.fn() },
      );

      await expect(destination.finalize(handle)).resolves.toMatchObject({
        providerId: 'photo-1',
        metadata: { sid: 'sid-2' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses rclone copyto through the bridge runner', async () => {
    const runner = {
      run: vi.fn(async (args: string[]) => ({
        stdout: args.includes('--json') ? '{"version":"1.66.0"}' : '',
        stderr: '',
      })),
    };
    const bridge = new RcloneBridge({ runner });
    await expect(bridge.version()).resolves.toEqual({
      version: '1.66.0',
      ok: true,
    });

    const destination = new RcloneDestination(bridge);
    const handle = await destination.upload(
      {
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
          kind: 'rclone',
          connectionId: 'rclone-1',
          approvalRequired: false,
          target: { remote: 'nas', path: 'Backup/Neuma/video.mp4' },
        },
      },
      { recordChunkProgress: vi.fn() },
    );

    await expect(destination.finalize(handle)).resolves.toMatchObject({
      providerId: 'nas:Backup/Neuma/video.mp4',
    });
  });
});
