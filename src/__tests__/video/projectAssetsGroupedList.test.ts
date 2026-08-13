import { describe, expect, it } from 'vitest';

import {
  dedupeProjectAssets,
  projectAssetVariantCounts,
  projectAssetMatchesQuery,
} from '@/components/video/assets/ProjectAssetsGroupedList';
import {
  projectAssetDisplayName,
  projectAssetDisplaySubtitle,
} from '@/components/video/assets/ProjectAssetTile';
import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

describe('project asset list helpers', () => {
  it('dedupes catalog-backed rows and prefers the richer provider-backed copy', () => {
    const provenance = {
      provider: 'immich',
      catalogAssetId: 'c8bda7b1',
      sourceDisplayName: '20260523_142704.jpg',
    };
    const oldRow: ProjectAsset = {
      id: 'old-row',
      kind: 'image',
      source: 'downloaded',
      path: 'catalog:c8bda7b1',
      materializationState: 'referenced',
      metadata: {
        durationMs: 0,
        width: 4000,
        height: 3000,
        fileSize: 3200,
      },
      provenance,
    };
    const richRow: ProjectAsset = {
      ...oldRow,
      id: 'rich-row',
      provenance: {
        ...provenance,
        connectionId: 'local_immich',
        sourceId: 'photo-1',
        thumbnailUrl: 'immich-thumbnail:photo-1',
      },
    };

    const deduped = dedupeProjectAssets([oldRow, richRow]);

    expect(deduped).toEqual([richRow]);
    expect(projectAssetDisplayName(richRow)).toBe('20260523_142704.jpg');
    expect(projectAssetDisplaySubtitle(richRow)).toBe('20260523_142704.jpg');
    expect(projectAssetMatchesQuery(richRow, '142704')).toBe(true);
  });

  it('hides generated catalog filenames for materialized catalog assets', () => {
    const asset: ProjectAsset = {
      id: 'materialized-catalog-row',
      kind: 'image',
      source: 'downloaded',
      path: 'videos/project/assets/catalog-651359cb-20260529_133714.jpg',
      materializationState: 'ready',
      metadata: {
        durationMs: 0,
        width: 4000,
        height: 3000,
        fileSize: 4126949,
      },
      provenance: {
        provider: 'immich',
        catalogAssetId: '77359449',
        sourceDisplayName: '20260529_133714.jpg',
      },
    };

    expect(projectAssetDisplayName(asset)).toBe('20260529_133714.jpg');
    expect(projectAssetDisplaySubtitle(asset)).toBe('20260529_133714.jpg');
    expect(projectAssetMatchesQuery(asset, 'catalog-651359cb')).toBe(false);
  });

  it('groups generated variants by collection id', () => {
    const first = generatedAsset('first', 'sunrise');
    const second = generatedAsset('second', 'sunset');

    const deduped = dedupeProjectAssets([first, second]);
    const variantCounts = projectAssetVariantCounts([first, second]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe('first');
    expect(variantCounts.get('collection:scene-1')).toBe(2);
  });
});

function generatedAsset(id: string, prompt: string): ProjectAsset {
  return {
    id,
    kind: 'image',
    source: 'ai-image',
    path: `videos/project/assets/${id}.png`,
    collectionId: 'scene-1',
    collectionLabel: 'Scene 1 variants',
    metadata: { durationMs: 0, width: 1024, height: 1024 },
    provenance: {
      provider: 'seedream-5-0',
      model: 'seedream-5-0',
      prompt,
      variantOf: 'scene-1',
    },
  };
}
