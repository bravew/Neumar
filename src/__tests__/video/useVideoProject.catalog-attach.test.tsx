import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVideoProject } from '@/shared/hooks/useVideoProject';
import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useVideoProject catalog attaches', () => {
  it('keeps all assets when concurrent attach responses return stale project snapshots', async () => {
    const baseProject = projectWithAssets([]);
    const beach = projectAsset('asset-beach', 'catalog-beach');
    const skyline = projectAsset('asset-skyline', 'catalog-skyline');
    const beachAttach = deferred<Response>();
    const skylineAttach = deferred<Response>();

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (init?.method !== 'POST') {
          return Promise.resolve(jsonResponse({ project: baseProject }));
        }
        if (href.includes('/catalog-beach/attach')) {
          return beachAttach.promise;
        }
        if (href.includes('/catalog-skyline/attach')) {
          return skylineAttach.promise;
        }
        throw new Error(`Unexpected request: ${href}`);
      }),
    );

    const { result } = renderHook(() => useVideoProject('project-1'));

    await waitFor(() => expect(result.current.project).toEqual(baseProject));

    let beachPromise: ReturnType<typeof result.current.attachCatalogAsset>;
    let skylinePromise: ReturnType<typeof result.current.attachCatalogAsset>;
    act(() => {
      beachPromise = result.current.attachCatalogAsset('catalog-beach');
      skylinePromise = result.current.attachCatalogAsset('catalog-skyline');
    });

    await act(async () => {
      skylineAttach.resolve(
        jsonResponse({
          project: projectWithAssets([skyline], '2026-06-27T12:01:00.000Z'),
          asset: skyline,
        }),
      );
      await skylinePromise;
    });

    await act(async () => {
      beachAttach.resolve(
        jsonResponse({
          project: projectWithAssets([beach], '2026-06-27T12:00:30.000Z'),
          asset: beach,
        }),
      );
      await beachPromise;
    });

    expect(result.current.project?.assets.map((asset) => asset.id)).toEqual([
      'asset-skyline',
      'asset-beach',
    ]);
  });
});

function projectWithAssets(
  assets: ProjectAsset[],
  updatedAt = '2026-06-27T12:00:00.000Z',
): VideoProject {
  return {
    id: 'project-1',
    name: 'Project',
    template: 'custom',
    prompt: '',
    assets,
    createdAt: '2026-06-27T11:00:00.000Z',
    updatedAt,
  };
}

function projectAsset(id: string, catalogAssetId: string): ProjectAsset {
  return {
    id,
    kind: 'video',
    source: 'downloaded',
    path: `catalog:${catalogAssetId}`,
    materializationState: 'referenced',
    metadata: { durationMs: 1000 },
    provenance: {
      provider: 'asset-catalog',
      catalogAssetId,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
