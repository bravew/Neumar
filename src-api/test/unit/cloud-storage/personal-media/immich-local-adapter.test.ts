import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImmichLocalAdapter } from '@/shared/integrations/cloud-storage';
import type { PathMapping } from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

const credential = {
  credentialId: 'cred-1',
  provider: 'immich' as const,
  baseUrl: 'http://192.168.1.20:2283',
  apiKey: 'immich-key',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});

describe('ImmichLocalAdapter', () => {
  it('uses broker credentials to call the local Immich API', async () => {
    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input).endsWith('/api/search/metadata')) {
          return jsonResponse({ assets: { count: 0, items: [] } });
        }
        expect(String(input)).toBe('http://192.168.1.20:2283/api/albums');
        return jsonResponse([
          {
            id: 'album-1',
            albumName: 'Trips',
            assetCount: 3,
          },
        ]);
      },
    );
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      { list: () => [] },
      fetchFn as typeof fetch,
    );

    await expect(adapter.listChildren()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'album:album-1', name: 'Trips' })],
    });
    for (const call of fetchFn.mock.calls) {
      expect((call[1]?.headers as Headers).get('x-api-key')).toBe('immich-key');
    }
  });

  it('uses a verified LAN bridge mapping for original downloads', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'immich-local-'));
    tempDirs.push(tempDir);
    await writeFile(path.join(tempDir, 'image.jpg'), 'hello');
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://192.168.1.20:2283/api/assets/asset-1');
      return jsonResponse({
        id: 'asset-1',
        originalFileName: 'image.jpg',
        originalMimeType: 'image/jpeg',
        originalPath: '/usr/src/app/external/image.jpg',
        exifInfo: { fileSizeInByte: 5 },
      });
    });
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      {
        list: () => [
          mapping({
            localMountPath: tempDir,
            verified: true,
          }),
        ],
      },
      fetchFn as typeof fetch,
    );

    const response = await adapter.download('asset-1');

    await expect(response.text()).resolves.toBe('hello');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('streams videos through the Immich playback endpoint and forwards Range', async () => {
    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/assets/asset-1')) {
          return jsonResponse({
            id: 'asset-1',
            originalFileName: 'clip.mp4',
            originalMimeType: 'video/mp4',
            originalPath: '/usr/src/app/external/clip.mp4',
            exifInfo: { fileSizeInByte: 1024 },
            type: 'VIDEO',
          });
        }
        expect(url).toBe(
          'http://192.168.1.20:2283/api/assets/asset-1/video/playback',
        );
        const range = (init?.headers as Headers | undefined)?.get('Range');
        expect(range).toBe('bytes=0-511');
        return new Response('partial', {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': 'bytes 0-511/1024',
            'content-length': '512',
            'accept-ranges': 'bytes',
          },
        });
      },
    );
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      { list: () => [] },
      fetchFn as typeof fetch,
    );

    const response = await adapter.download('asset-1', {
      range: 'bytes=0-511',
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-range')).toBe('bytes 0-511/1024');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    await expect(response.text()).resolves.toBe('partial');
  });

  it('serves Range requests from the local bridge for images', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'immich-range-'));
    tempDirs.push(tempDir);
    await writeFile(path.join(tempDir, 'image.jpg'), 'hello-world');
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        id: 'asset-1',
        originalFileName: 'image.jpg',
        originalMimeType: 'image/jpeg',
        originalPath: '/usr/src/app/external/image.jpg',
        exifInfo: { fileSizeInByte: 11 },
      }),
    );
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      {
        list: () => [mapping({ localMountPath: tempDir, verified: true })],
      },
      fetchFn as typeof fetch,
    );

    const response = await adapter.download('asset-1', {
      range: 'bytes=0-4',
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-4/11');
    expect(response.headers.get('content-length')).toBe('5');
    await expect(response.text()).resolves.toBe('hello');
  });

  it('writes direct-then-scan uploads to a verified local mapping', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'immich-direct-'));
    tempDirs.push(tempDir);
    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          'http://192.168.1.20:2283/api/libraries/library-1/scan',
        );
        expect(init?.method).toBe('POST');
        return new Response(null, { status: 204 });
      },
    );
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      {
        list: () => [
          mapping({
            localMountPath: tempDir,
            immichPathPrefix: '/usr/src/app/external/photos/',
            verified: true,
          }),
        ],
      },
      fetchFn as typeof fetch,
    );

    const uploaded = await adapter.upload({
      parentId: null,
      name: 'new.jpg',
      content: new Blob(['image-bytes'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      metadata: {
        writeMode: 'direct-then-scan',
        libraryId: 'library-1',
        immichPathPrefix: '/usr/src/app/external/photos/',
        relativePath: 'incoming/new.jpg',
      },
    });

    await expect(
      import('fs/promises').then(({ readFile }) =>
        readFile(path.join(tempDir, 'incoming', 'new.jpg'), 'utf8'),
      ),
    ).resolves.toBe('image-bytes');
    expect(uploaded).toMatchObject({
      id: 'pending-scan:library-1:incoming/new.jpg',
      path: '/usr/src/app/external/photos/incoming/new.jpg',
      mediaMetadata: {
        fileInfo: {
          originalPath: '/usr/src/app/external/photos/incoming/new.jpg',
        },
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('blocks redirects from the local Immich API', async () => {
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      { list: () => [] },
      vi.fn(async () => {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest' },
        });
      }) as typeof fetch,
    );

    await expect(adapter.getMetadata('asset-1')).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('polls Immich changes directly from the local API', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/assets');
      expect(url.searchParams.get('updatedAfter')).toBe(
        '2026-01-01T00:00:00.000Z',
      );
      expect(url.searchParams.get('take')).toBe('2');
      expect(url.searchParams.get('skip')).toBe('0');
      return jsonResponse([
        {
          id: 'asset-1',
          originalFileName: 'image.jpg',
          originalMimeType: 'image/jpeg',
          exifInfo: { fileSizeInByte: 5 },
          updatedAt: '2026-01-01T00:00:05.000Z',
        },
      ]);
    });
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      { list: () => [] },
      fetchFn as typeof fetch,
    );

    await expect(
      adapter.getChanges({
        cursor: '2026-01-01T00:00:00.000Z',
        limit: 2,
      }),
    ).resolves.toMatchObject({
      changes: [
        {
          type: 'updated',
          itemId: 'asset-1',
          item: { id: 'asset-1', provider: 'immich' },
        },
      ],
      hasMore: false,
    });
  });
});

describe('ImmichLocalAdapter timeline buckets', () => {
  it('passes through monthly buckets sorted newest first', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/timeline/buckets');
      expect(url.searchParams.get('size')).toBe('MONTH');
      return jsonResponse([
        { timeBucket: '2024-04-01T00:00:00.000Z', count: 12 },
        { timeBucket: '2025-01-01T00:00:00.000Z', count: 5 },
      ]);
    });
    const adapter = new ImmichLocalAdapter(
      'conn-1',
      {} as never,
      { resolve: vi.fn(async () => credential) },
      { list: () => [] },
      fetchFn as typeof fetch,
    );

    const result = await adapter.getTimelineBuckets();

    expect(result.size).toBe('month');
    expect(result.buckets).toEqual([
      { bucket: '2025-01', count: 5 },
      { bucket: '2024-04', count: 12 },
    ]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function mapping(overrides: Partial<PathMapping> = {}): PathMapping {
  return {
    id: 'mapping-1',
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
