import { describe, expect, it, vi } from 'vitest';

import {
  ASSET_DRAG_MIME,
  readAssetDragPayload,
  writeAssetDragPayload,
} from '@/shared/assets';

describe('asset drag payloads', () => {
  it('round-trips selected catalog asset ids', () => {
    const dataTransfer = createDataTransfer();

    writeAssetDragPayload(dataTransfer, {
      assetIds: ['asset-1', 'asset-2'],
      primaryKind: 'image',
      source: 'library',
    });

    expect(readAssetDragPayload(dataTransfer)).toEqual({
      assetIds: ['asset-1', 'asset-2'],
      primaryKind: 'image',
      source: 'library',
    });
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('rejects malformed or filter-only payloads', () => {
    expect(
      readAssetDragPayload(
        createDataTransfer({
          [ASSET_DRAG_MIME]: JSON.stringify({
            assetIds: ['asset-1'],
            primaryKind: 'all',
            source: 'library',
          }),
        }),
      ),
    ).toBeNull();
    expect(
      readAssetDragPayload(
        createDataTransfer({
          [ASSET_DRAG_MIME]: JSON.stringify({
            assetIds: [],
            primaryKind: 'image',
            source: 'library',
          }),
        }),
      ),
    ).toBeNull();
  });
});

function createDataTransfer(
  initial: Record<string, string> = {},
): DataTransfer {
  const data = new Map(Object.entries(initial));
  return {
    effectAllowed: 'uninitialized',
    getData: vi.fn((type: string) => data.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    }),
    types: Array.from(data.keys()),
  } as unknown as DataTransfer;
}
