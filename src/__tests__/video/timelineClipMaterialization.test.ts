import { describe, expect, it } from 'vitest';

import { timelineClipMaterializationStatus } from '@/components/video/timeline/timelineClipMaterialization';
import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import type { VideoMediaItem } from '@/shared/types/video';

describe('timelineClipMaterializationStatus', () => {
  it('shows a pending placeholder for referenced cloud assets', () => {
    expect(
      timelineClipMaterializationStatus(
        mediaItemFixture({ materializationState: 'referenced' }),
        {},
      ),
    ).toEqual({ phase: 'pending', percent: null });
  });

  it('uses live catalog materialization progress when present', () => {
    const states: MaterializationStateMap = {
      'catalog-asset-a': {
        assetId: 'catalog-asset-a',
        status: 'progress',
        bytes: 512,
        total: 1024,
        percent: 49.6,
        message: null,
        updatedAt: 1000,
      },
    };

    expect(
      timelineClipMaterializationStatus(
        mediaItemFixture({ materializationState: 'referenced' }),
        states,
      ),
    ).toMatchObject({ phase: 'progress', percent: 50 });
  });

  it('hides the placeholder after completion or ready state', () => {
    const states: MaterializationStateMap = {
      'catalog-asset-a': {
        assetId: 'catalog-asset-a',
        status: 'complete',
        bytes: 1024,
        total: 1024,
        percent: 100,
        message: null,
        updatedAt: 1000,
      },
    };

    expect(
      timelineClipMaterializationStatus(
        mediaItemFixture({ materializationState: 'referenced' }),
        states,
      ),
    ).toBeNull();
    expect(
      timelineClipMaterializationStatus(
        mediaItemFixture({ materializationState: 'ready' }),
        {},
      ),
    ).toBeNull();
  });
});

function mediaItemFixture(
  overrides: Partial<VideoMediaItem> = {},
): VideoMediaItem {
  return {
    id: 'project-asset-a',
    kind: 'video',
    source: 'upload',
    path: 'catalog:catalog-asset-a',
    metadata: {
      durationMs: 12_000,
      width: 1920,
      height: 1080,
      fileSize: 20_000_000,
    },
    provenance: {
      provider: 'drive',
      catalogAssetId: 'catalog-asset-a',
    },
    ...overrides,
  };
}
