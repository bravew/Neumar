import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BoxProxyAdapter,
  type CloudFile,
  DropboxProxyAdapter,
  OneDriveProxyAdapter,
  PersonalMediaProxyAdapter,
  StockCatalogProxyAdapter,
} from '@/shared/integrations/cloud-storage';
import type { PathMapping } from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});

describe('DropboxProxyAdapter', () => {
  it('maps change feed requests to the site proxy route', async () => {
    const siteApiClient = {
      getJson: vi.fn(async () => ({ changes: [], hasMore: false })),
    };
    const adapter = new DropboxProxyAdapter('conn-1', siteApiClient as never);

    await adapter.getChanges({ cursor: 'cursor-1', limit: 50 });

    expect(siteApiClient.getJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/changes?cursor=cursor-1&limit=50',
    );
  });

  it('streams downloads through the site API client', async () => {
    const response = new Response('hello');
    const siteApiClient = {
      streamGetResponse: vi.fn(async () => response),
    };
    const adapter = new DropboxProxyAdapter('conn-1', siteApiClient as never);

    await expect(adapter.download('file-1')).resolves.toBe(response);
    expect(siteApiClient.streamGetResponse).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/items/file-1/content',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('forwards Range header to the site API client', async () => {
    const response = new Response('hello');
    const siteApiClient = {
      streamGetResponse: vi.fn<
        (path: string, init?: RequestInit) => Promise<Response>
      >(async () => response),
    };
    const adapter = new DropboxProxyAdapter('conn-1', siteApiClient as never);

    await adapter.download('file-1', { range: 'bytes=0-1023' });
    const [, init] = siteApiClient.streamGetResponse.mock.calls[0]!;
    const headers = init?.headers as Headers;
    expect(headers.get('Range')).toBe('bytes=0-1023');
  });
});

describe('StockCatalogProxyAdapter', () => {
  it('declares read-only license capabilities', () => {
    const adapter = new StockCatalogProxyAdapter(
      'unsplash',
      'conn-1',
      {} as never,
    );

    expect(adapter.provider).toBe('unsplash');
    expect(adapter.getCapabilities()).toMatchObject({
      fullTextSearch: true,
      thumbnails: true,
      licenseInfo: {
        attributionRequired: true,
        downloadTrackingRequired: true,
      },
    });
  });

  it('rejects write operations', async () => {
    const adapter = new StockCatalogProxyAdapter(
      'openverse',
      'conn-1',
      {} as never,
    );

    await expect(adapter.delete('asset-1')).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(
      adapter.upload({
        parentId: null,
        name: 'asset.jpg',
        content: new Blob(['x']),
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('records provider download tracking through the site proxy', async () => {
    const siteApiClient = {
      postJson: vi.fn(async () => ({})),
    };
    const adapter = new StockCatalogProxyAdapter(
      'unsplash',
      'conn-1',
      siteApiClient as never,
    );

    await adapter.recordDownload('photo-1', {
      trackingUrl: 'https://api.unsplash.com/photos/photo-1/download',
    });

    expect(siteApiClient.postJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/items/photo-1/download-tracking',
      { trackingUrl: 'https://api.unsplash.com/photos/photo-1/download' },
      { signal: undefined },
    );
  });
});

describe('PersonalMediaProxyAdapter', () => {
  it('declares structured metadata and LAN bridge counts', () => {
    const adapter = new PersonalMediaProxyAdapter(
      'immich',
      'conn-1',
      {} as never,
      {
        list: () => [
          mapping('mapping-1', { verified: true }),
          mapping('mapping-2', { verified: false }),
          mapping('mapping-3', { verified: true, disabled: true }),
        ],
      },
    );

    expect(adapter.provider).toBe('immich');
    expect(adapter.getCapabilities()).toMatchObject({
      fullTextSearch: true,
      mediaMetadata: { structuredSearch: true },
      lanBridge: {
        available: true,
        verifiedMappings: 1,
        totalMappings: 3,
      },
    });
  });

  it('uses a verified LAN bridge mapping before remote download', async () => {
    const siteApiClient = {
      getJson: vi.fn(async () => ({
        id: 'asset-1',
        name: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 5,
        createdAt: new Date(),
        modifiedAt: new Date(),
        parentId: null,
        isFolder: false,
        provider: 'immich',
        mediaMetadata: {
          fileInfo: {
            originalPath: '/usr/src/app/external/image.jpg',
          },
        },
      })),
      streamGet: vi.fn(),
    };
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'immich-proxy-'));
    tempDirs.push(tempDir);
    await writeFile(path.join(tempDir, 'image.jpg'), 'hello');
    const adapter = new PersonalMediaProxyAdapter(
      'immich',
      'conn-1',
      siteApiClient as never,
      {
        list: () => [
          mapping('mapping-1', {
            localMountPath: tempDir,
            immichPathPrefix: '/usr/src/app/external/',
            verified: true,
          }),
        ],
      },
    );

    const response = await adapter.download('asset-1');

    await expect(response.text()).resolves.toBe('hello');
    expect(siteApiClient.streamGet).not.toHaveBeenCalled();
  });
});

describe('BoxProxyAdapter', () => {
  it('declares longpoll and extracted text representation support', () => {
    const adapter = new BoxProxyAdapter('conn-1', {} as never);

    expect(adapter.provider).toBe('box');
    expect(adapter.getCapabilities()).toMatchObject({
      fullTextSearch: true,
      longPoll: true,
      extractedTextRepresentation: true,
    });
  });

  it('preserves upload metadata in the site FormData payload', async () => {
    const siteApiClient = {
      putForm: vi.fn<(path: string, formData: FormData) => Promise<CloudFile>>(
        async () => ({
          id: 'file-1',
          name: 'file.txt',
          mimeType: 'text/plain',
          size: 1,
          createdAt: new Date(),
          modifiedAt: new Date(),
          parentId: null,
          isFolder: false,
          provider: 'box',
        }),
      ),
    };
    const adapter = new BoxProxyAdapter('conn-1', siteApiClient as never);

    await adapter.upload({
      parentId: 'folder-1',
      name: 'file.txt',
      content: new Blob(['x'], { type: 'text/plain' }),
      mimeType: 'text/plain',
      overwrite: true,
      metadata: { source: 'test' },
    });

    expect(siteApiClient.putForm).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/items',
      expect.any(FormData),
    );
    const [, form] = siteApiClient.putForm.mock.calls[0]!;
    expect(form.get('parentId')).toBe('folder-1');
    expect(form.get('overwrite')).toBe('true');
    expect(form.get('metadata')).toBe('{"source":"test"}');
  });
});

function mapping(
  id: string,
  overrides: Partial<PathMapping> = {},
): PathMapping {
  return {
    id,
    connectionId: 'conn-1',
    immichPathPrefix: '/usr/src/app/external/',
    localMountPath: '/Volumes/photos',
    disabled: false,
    verified: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('OneDriveProxyAdapter', () => {
  it('maps delta cursor requests and root ids to the changes route', async () => {
    const siteApiClient = {
      getJson: vi.fn(async () => ({ changes: [], hasMore: false })),
    };
    const adapter = new OneDriveProxyAdapter('conn-1', siteApiClient as never);

    await adapter.getChanges({
      cursor: 'https://graph.microsoft.com/v1.0/drives/d/root/delta?token=x',
      rootId: 'drive-1',
    });

    expect(siteApiClient.getJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/changes?cursor=https%3A%2F%2Fgraph.microsoft.com%2Fv1.0%2Fdrives%2Fd%2Froot%2Fdelta%3Ftoken%3Dx&rootId=drive-1',
    );
  });

  it('streams downloads through the shared site proxy adapter', async () => {
    const response = new Response('payload');
    const siteApiClient = {
      streamGetResponse: vi.fn(async () => response),
    };
    const adapter = new OneDriveProxyAdapter('conn-1', siteApiClient as never);

    await expect(adapter.download('drive-1:item-1')).resolves.toBe(response);
    expect(siteApiClient.streamGetResponse).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/items/drive-1%3Aitem-1/content',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });
});
