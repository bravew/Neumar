import { describe, expect, it, vi } from 'vitest';

import {
  findBridgeVerificationAsset,
  runPathMappingReverificationCycle,
  type ReverificationCycleDeps,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';
import type {
  ImmichBridgeAsset,
  PathMapping,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

const mapping: PathMapping = {
  id: 'mapping-1',
  connectionId: 'conn-1',
  immichPathPrefix: '/usr/src/app/external/photos/',
  localMountPath: '/Volumes/photos',
  disabled: false,
  verified: true,
  verifiedAt: '2026-05-02T00:00:00.000Z',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

describe('LAN bridge path mapping re-verification scheduler', () => {
  it('marks due mappings verified when a fresh sample matches', async () => {
    const store = createStore([mapping]);
    const asset: ImmichBridgeAsset = {
      id: 'asset-1',
      originalPath: '/usr/src/app/external/photos/a.jpg',
      fileSizeBytes: 5,
      checksum: 'sha1:abc',
    };

    const summary = await runPathMappingReverificationCycle({
      store,
      findAsset: async () => asset,
      verify: async () => ({
        verified: true,
        verificationHash: 'abc',
        resolution: {
          kind: 'local',
          absolutePath: '/Volumes/photos/a.jpg',
          sizeBytes: 5,
        },
      }),
    });

    expect(summary).toEqual({ checked: 1, verified: 1, failed: 0 });
    expect(store.markVerification).toHaveBeenCalledWith('mapping-1', true, {
      verificationHash: 'abc',
      lastError: undefined,
    });
  });

  it('unverifies a due mapping when no sample asset is available', async () => {
    const store = createStore([mapping]);

    const summary = await runPathMappingReverificationCycle({
      store,
      findAsset: async () => null,
    });

    expect(summary).toEqual({ checked: 1, verified: 0, failed: 1 });
    expect(store.markVerification).toHaveBeenCalledWith('mapping-1', false, {
      lastError: 'no_sample_asset',
    });
  });

  it('picks the smallest matching asset from the active adapter page', async () => {
    const adapter = {
      listChildren: vi.fn(async () => ({
        items: [
          {
            id: 'outside',
            name: 'outside.jpg',
            mimeType: 'image/jpeg',
            size: 2,
            isFolder: false,
            parentId: null,
            provider: 'immich',
            mediaMetadata: {
              fileInfo: { originalPath: '/other/outside.jpg' },
            },
          },
          {
            id: 'large',
            name: 'large.jpg',
            mimeType: 'image/jpeg',
            size: 10,
            isFolder: false,
            parentId: null,
            provider: 'immich',
            etag: 'large-hash',
            mediaMetadata: {
              fileInfo: {
                originalPath: '/usr/src/app/external/photos/large.jpg',
              },
            },
          },
          {
            id: 'small',
            name: 'small.jpg',
            mimeType: 'image/jpeg',
            size: 4,
            isFolder: false,
            parentId: null,
            provider: 'immich',
            mediaMetadata: {
              fileInfo: {
                originalPath: '/usr/src/app/external/photos/small.jpg',
                checksum: 'small-hash',
              },
            },
          },
        ],
        hasMore: false,
      })),
    };

    const asset = await findBridgeVerificationAsset(
      mapping,
      () => adapter as never,
    );

    expect(adapter.listChildren).toHaveBeenCalledWith({ limit: 50 });
    expect(asset).toEqual({
      id: 'small',
      originalPath: '/usr/src/app/external/photos/small.jpg',
      fileSizeBytes: 4,
      checksum: 'small-hash',
    });
  });
});

function createStore(mappings: PathMapping[]) {
  return {
    listDueForReverification: vi.fn<
      ReverificationCycleDeps['store']['listDueForReverification']
    >(() => mappings),
    markVerification:
      vi.fn<ReverificationCycleDeps['store']['markVerification']>(),
  };
}
