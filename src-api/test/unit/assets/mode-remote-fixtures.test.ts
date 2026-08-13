import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetMaterializer,
  AssetRegistry,
  __resetAssetMaterializerForTests,
  __setAssetMaterializerForTests,
} from '@/shared/assets';
import { closeDatabase, getDatabase } from '@/shared/db';
import { saveSetting } from '@/shared/db/operations';
import type {
  CloudFile,
  CloudStorageAdapter,
  CloudStorageProvider,
} from '@/shared/integrations/cloud-storage';
import { attachCatalogAssetToDesign } from '@/shared/services/design-mode/catalog-assets';
import { writeProjectTextFile } from '@/shared/services/design-mode/fs';
import { createDesignProject } from '@/shared/services/design-mode/projects';
import { attachCatalogAssetToProject } from '@/shared/video/catalog-assets';
import { createProject } from '@/shared/video/store';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface RemoteFixture {
  bytes: Buffer;
  mime: string;
  name: string;
}

interface DownloadCall {
  provider: CloudStorageProvider;
  providerItemId: string;
  range?: string;
}

describe('mode remote asset fixtures', () => {
  let tempHome = '';
  let workDir = '';
  let remoteFiles: Map<string, RemoteFixture>;
  let downloadCalls: DownloadCall[];

  beforeEach(async () => {
    closeDatabase();
    __resetAssetMaterializerForTests();
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-mode-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-mode-work-'));
    remoteFiles = new Map();
    downloadCalls = [];
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    saveSetting('workDir', workDir);
    saveSetting('assets.catalog_enabled', 'true');
    __setAssetMaterializerForTests(
      new AssetMaterializer({
        getWorkspaceRoot: () => workDir,
        resolveAdapter: async (asset) => {
          if (asset.source !== 'google_drive' && asset.source !== 'box') {
            return null;
          }
          return createRemoteAdapter(asset.source, remoteFiles, downloadCalls);
        },
        scheduleJobDrain: () => {},
      }),
    );
  });

  afterEach(async () => {
    __resetAssetMaterializerForTests();
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('attaches a synthetic Google Drive image to a video project through the materializer', async () => {
    const sourceId = `drive-image-${randomUUID()}`;
    const sourceBytes = Buffer.concat([
      PNG_HEADER,
      Buffer.from(`drive-video-${randomUUID()}`),
    ]);
    remoteFiles.set(sourceId, {
      bytes: sourceBytes,
      mime: 'image/png',
      name: 'Drive campaign.png',
    });
    const registry = new AssetRegistry();
    const { asset } = registry.upsertRemote({
      source: 'google_drive',
      connectionId: `drive-${randomUUID()}`,
      sourceId,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      width: 1280,
      height: 720,
      title: 'Drive campaign',
      provenance: {
        licenseInfo: {
          provider: 'Google Drive',
          license: 'Internal',
          requiresAttribution: false,
          attributionText: 'Drive source owner',
        },
      },
    });
    const project = await createProject({
      name: 'Remote Drive video',
      template: 'custom',
    });

    const attached = await attachCatalogAssetToProject(project.id, asset.id, {
      role: 'b-roll',
      sessionId: 'drive-session',
      clientRequestId: 'drive-video-attach',
      hydrate: 'proxy',
    });

    expect(downloadCalls).toEqual([
      { provider: 'google_drive', providerItemId: sourceId },
    ]);
    expect(attached.asset).toMatchObject({
      kind: 'image',
      // Catalog attaches are tagged `'downloaded'` — see catalog-assets.ts.
      source: 'downloaded',
      provenance: {
        // Pulled from `catalogAsset.provenance.provider` when present, else
        // falls back to the catalog `source` enum. The fixture doesn't set a
        // top-level provider, so we expect the catalog source (`google_drive`).
        provider: 'google_drive',
        sourceUrl: `asset:${asset.id}`,
        sourceDisplayName: 'Drive campaign',
        attribution: 'Drive source owner',
        license: 'Internal',
        attributionRequired: false,
      },
    });
    await expect(
      fs.readFile(path.join(workDir, attached.asset.path)),
    ).resolves.toEqual(sourceBytes);
    expect(new AssetRegistry().get(asset.id)?.attachments).toEqual([
      {
        scope: 'video_project',
        scopeId: project.id,
        role: 'b-roll',
        attachedAt: expect.any(Number),
      },
    ]);
    expect(
      getDatabase()
        .prepare(
          `SELECT origin_provider, origin_source_id
           FROM asset_cache
           WHERE origin_source_id = ?`,
        )
        .get(sourceId),
    ).toEqual({
      origin_provider: 'google_drive',
      origin_source_id: sourceId,
    });
  });

  it('attaches a synthetic Box image to Design and inlines it during HTML export', async () => {
    const sourceId = `box-image-${randomUUID()}`;
    const sourceBytes = Buffer.concat([
      PNG_HEADER,
      Buffer.from(`box-design-${randomUUID()}`),
    ]);
    remoteFiles.set(sourceId, {
      bytes: sourceBytes,
      mime: 'image/png',
      name: 'Box hero.png',
    });
    const registry = new AssetRegistry();
    const { asset } = registry.upsertRemote({
      source: 'box',
      connectionId: `box-${randomUUID()}`,
      sourceId,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      width: 1024,
      height: 768,
      title: 'Box hero',
      provenance: {
        licenseInfo: {
          provider: 'Box',
          license: 'Internal',
          requiresAttribution: true,
          attributionText: 'Box DAM asset',
        },
      },
    });
    const project = await createDesignProject({
      title: 'Remote Box design',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      `<main><img src="asset:${asset.id}" alt="Remote Box hero"></main>`,
    );

    const attached = await attachCatalogAssetToDesign(project.id, asset.id, {
      role: 'inline',
      sessionId: 'box-session',
      clientRequestId: 'box-design-attach',
    });
    const { designRoutes } = await import('@/app/api/design');
    const response = await designRoutes.request(
      `/projects/${project.id}/export/file?path=${encodeURIComponent(
        'artifacts/index.html',
      )}&inline=true`,
    );

    expect(downloadCalls).toEqual([
      { provider: 'box', providerItemId: sourceId },
    ]);
    expect(attached.asset).toMatchObject({
      id: asset.id,
      kind: 'image',
      path: `assets/imports/${asset.id}.png`,
      mime: 'image/png',
      provider: 'box',
      providerId: sourceId,
    });
    await expect(
      fs.readFile(
        path.join(workDir, 'design-projects', project.id, attached.asset.path),
      ),
    ).resolves.toEqual(sourceBytes);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `src="data:image/png;base64,${sourceBytes.toString('base64')}"`,
    );
    expect(html).toContain('Box DAM asset');
  });
});

function createRemoteAdapter(
  provider: 'google_drive' | 'box',
  files: Map<string, RemoteFixture>,
  downloadCalls: DownloadCall[],
): CloudStorageAdapter {
  const emptyPage = { items: [], hasMore: false };
  return {
    provider,
    getCapabilities: () => ({
      fullTextSearch: false,
      thumbnails: false,
      exportContent: true,
      watch: false,
      longPoll: false,
      sharedDrives: provider === 'google_drive',
    }),
    listChildren: async () => emptyPage,
    search: async () => emptyPage,
    getMetadata: async (providerItemId) =>
      cloudFileFor(provider, providerItemId, fixtureFor(files, providerItemId)),
    download: async (providerItemId, init) => {
      downloadCalls.push({
        provider,
        providerItemId,
        ...(init?.range ? { range: init.range } : {}),
      });
      return responseFromFixture(fixtureFor(files, providerItemId));
    },
    exportContent: async ({ providerItemId }) => {
      const fixture = fixtureFor(files, providerItemId);
      return {
        fileId: providerItemId,
        content: fixture.bytes.toString('base64'),
        mimeType: fixture.mime,
        size: fixture.bytes.byteLength,
        isBase64: true,
      };
    },
    createFolder: async (_parentId, name) =>
      cloudFileFor(provider, `folder-${name}`, {
        bytes: Buffer.alloc(0),
        mime: 'application/vnd.folder',
        name,
      }),
    upload: async ({ name, content, mimeType }) =>
      cloudFileFor(provider, `upload-${name}`, {
        bytes: Buffer.isBuffer(content)
          ? content
          : Buffer.from(String(content)),
        mime: mimeType ?? 'application/octet-stream',
        name,
      }),
    updateMetadata: async (providerItemId) =>
      cloudFileFor(provider, providerItemId, fixtureFor(files, providerItemId)),
    move: async ({ providerItemId }) =>
      cloudFileFor(provider, providerItemId, fixtureFor(files, providerItemId)),
    copy: async ({ providerItemId }) =>
      cloudFileFor(provider, providerItemId, fixtureFor(files, providerItemId)),
    delete: async () => {},
    getChanges: async () => ({ changes: [], hasMore: false }),
  };
}

function fixtureFor(
  files: Map<string, RemoteFixture>,
  providerItemId: string,
): RemoteFixture {
  const fixture = files.get(providerItemId);
  if (!fixture) throw new Error(`Missing remote fixture: ${providerItemId}`);
  return fixture;
}

function cloudFileFor(
  provider: CloudStorageProvider,
  id: string,
  fixture: RemoteFixture,
): CloudFile {
  const now = new Date(0).toISOString();
  return {
    id,
    name: fixture.name,
    mimeType: fixture.mime,
    size: fixture.bytes.byteLength,
    createdAt: now,
    modifiedAt: now,
    parentId: null,
    isFolder: false,
    provider,
  };
}

function responseFromFixture(fixture: RemoteFixture): Response {
  const body = new Uint8Array(fixture.bytes).buffer as ArrayBuffer;
  return new Response(body, {
    headers: {
      'content-length': String(fixture.bytes.byteLength),
      'content-type': fixture.mime,
    },
  });
}
