import { describe, expect, it } from 'vitest';

import { analyzeProjectAssets } from '@/shared/video/asset-aspect';
import type { MediaItem, VideoProject } from '@/shared/video/types';

function asset(
  id: string,
  kind: MediaItem['kind'],
  width: number | undefined,
  height: number | undefined,
): MediaItem {
  return {
    id,
    kind,
    source: 'user',
    path: `videos/p/assets/${id}.x`,
    metadata: { durationMs: 0, width, height },
  } as MediaItem;
}

function project(assets: MediaItem[]): VideoProject {
  return {
    id: 'p',
    name: 'p',
    template: 'slideshow',
    prompt: '',
    assets,
  } as VideoProject;
}

describe('analyzeProjectAssets', () => {
  it('flags a square logo on 16:9 as needing a decision', () => {
    const result = analyzeProjectAssets(
      project([asset('logo', 'image', 1024, 1024)]),
      '16:9',
    );
    const logo = result.assets[0]!;
    expect(logo.orientation).toBe('square');
    expect(logo.fit).toBe('blur-pad');
    expect(logo.needsDecision).toBe(true);
    expect(result.decisionsNeeded).toBe(1);
  });

  it('flags a portrait photo on 16:9 (orientation flip) to ask', () => {
    const result = analyzeProjectAssets(
      project([asset('portrait', 'image', 1080, 1920)]),
      '16:9',
    );
    const photo = result.assets[0]!;
    expect(photo.orientation).toBe('portrait');
    expect(photo.fit).toBe('ask');
    expect(photo.needsDecision).toBe(true);
    expect(photo.cropLossPct).toBeGreaterThan(30);
  });

  it('treats a 16:9 photo on a 16:9 canvas as a clean cover', () => {
    const result = analyzeProjectAssets(
      project([asset('wide', 'image', 1920, 1080)]),
      '16:9',
    );
    const photo = result.assets[0]!;
    expect(photo.fit).toBe('cover');
    expect(photo.needsDecision).toBe(false);
  });

  it('recommends Ken Burns pan for a moderately-mismatched photo', () => {
    // 4:3 (1.333) on 16:9 (1.778): ~25% crop, image -> pan, no decision.
    const result = analyzeProjectAssets(
      project([asset('ph', 'image', 4000, 3000)]),
      '16:9',
    );
    const photo = result.assets[0]!;
    expect(photo.fit).toBe('pan');
    expect(photo.needsDecision).toBe(false);
  });

  it('asks when dimensions are unknown', () => {
    const result = analyzeProjectAssets(
      project([asset('mystery', 'image', undefined, undefined)]),
      '16:9',
    );
    expect(result.assets[0]!.fit).toBe('ask');
    expect(result.assets[0]!.needsDecision).toBe(true);
  });

  it('ignores audio assets', () => {
    const result = analyzeProjectAssets(
      project([asset('song', 'audio', undefined, undefined)]),
      '16:9',
    );
    expect(result.assets).toHaveLength(0);
  });

  function dated(
    id: string,
    capturedAt?: string,
    fileName?: string,
  ): MediaItem {
    return {
      id,
      kind: 'video',
      source: 'user',
      path: `videos/p/assets/${fileName ?? `${id}.mp4`}`,
      metadata: { durationMs: 8000, width: 1920, height: 1080, capturedAt },
    } as MediaItem;
  }

  it('suggests chronological order from capturedAt metadata', () => {
    const result = analyzeProjectAssets(
      project([
        dated('b', '2025-02-16T19:08:21Z'),
        dated('a', '2025-02-16T18:26:51Z'),
        dated('c', '2025-02-17T13:50:05Z'),
      ]),
      '16:9',
    );
    expect(result.suggestedOrder).toEqual(['a', 'b', 'c']);
    expect(result.assets.find((x) => x.assetId === 'a')?.orderBasis).toBe(
      'captured-at',
    );
  });

  it('orders by filename timestamp when metadata is absent (190821 after 182651)', () => {
    const result = analyzeProjectAssets(
      project([
        dated('first', undefined, '20250216_190821.mp4'),
        dated('second', undefined, '20250216_182651.mp4'),
      ]),
      '16:9',
    );
    // 18:26 precedes 19:08 chronologically despite attach order.
    expect(result.suggestedOrder).toEqual(['second', 'first']);
    expect(result.assets[0]?.orderBasis).toBe('filename');
  });

  it('falls back to natural filename order when no timestamps exist', () => {
    const result = analyzeProjectAssets(
      project([
        dated('b', undefined, 'IMG_0010.mp4'),
        dated('a', undefined, 'IMG_0002.mp4'),
        dated('c', undefined, 'IMG_0100.mp4'),
      ]),
      '16:9',
    );
    // Numeric-aware sort: 0002 < 0010 < 0100, not lexicographic.
    expect(result.suggestedOrder).toEqual(['a', 'b', 'c']);
    expect(result.assets[0]?.orderBasis).toBe('filename-sequence');
  });

  it('uses orderBasis name for label-only filenames with no digits', () => {
    const result = analyzeProjectAssets(
      project([
        dated('z', undefined, 'sunset.mp4'),
        dated('a', undefined, 'arrival.mp4'),
      ]),
      '16:9',
    );
    // Still proposes a sequence (alphabetical) as a last resort.
    expect(result.suggestedOrder).toEqual(['a', 'z']);
    expect(result.assets.every((a) => a.orderBasis === 'name')).toBe(true);
  });

  it('sorts timed assets before untimed ones, untimed by name', () => {
    const result = analyzeProjectAssets(
      project([
        dated('untimed', undefined, 'random-clip.mp4'),
        dated('timed', '2025-01-01T00:00:00Z', 'whatever.mp4'),
      ]),
      '16:9',
    );
    expect(result.suggestedOrder).toEqual(['timed', 'untimed']);
  });

  it('places undatable assets after datable ones in suggestedOrder', () => {
    const result = analyzeProjectAssets(
      project([
        dated('nodate', undefined, 'random.mp4'),
        dated('early', '2025-01-01T00:00:00Z'),
        dated('late', '2025-06-01T00:00:00Z'),
      ]),
      '16:9',
    );
    expect(result.suggestedOrder).toEqual(['early', 'late', 'nodate']);
  });

  function named(id: string, fileName: string, w = 512, h = 512): MediaItem {
    return {
      id,
      kind: 'image',
      source: 'user',
      path: `videos/p/assets/${fileName}`,
      metadata: { durationMs: 0, width: w, height: h },
    } as MediaItem;
  }

  it('flags a logo by filename and lists it in logoAssetIds', () => {
    const result = analyzeProjectAssets(
      project([named('brand', 'enercare-logo.png', 1920, 1080)]),
      '16:9',
    );
    expect(result.assets[0]?.isLikelyLogo).toBe(true);
    expect(result.logoAssetIds).toEqual(['brand']);
  });

  it('flags a square transparent graphic as a likely logo', () => {
    const result = analyzeProjectAssets(
      project([named('mark', 'asset_4821.png', 600, 600)]),
      '16:9',
    );
    expect(result.assets[0]?.isLikelyLogo).toBe(true);
  });

  it('does not flag a normal landscape jpg photo as a logo', () => {
    const result = analyzeProjectAssets(
      project([named('photo', '20250216_190821.jpg', 4000, 3000)]),
      '16:9',
    );
    expect(result.assets[0]?.isLikelyLogo).toBeUndefined();
    expect(result.logoAssetIds).toBeUndefined();
  });
});
