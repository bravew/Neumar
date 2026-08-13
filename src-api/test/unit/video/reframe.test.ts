import { describe, expect, it } from 'vitest';

import {
  buildReframeCropFilters,
  defaultReframeAnchor,
  resolveReframePlan,
} from '@/shared/video/reframe';

describe('video reframe helpers', () => {
  it('keeps 16:9 renders on the legacy contain path by default', () => {
    expect(resolveReframePlan({ aspectRatio: '16:9' })).toBeUndefined();
  });

  it('defaults portrait and square outputs to center crop', () => {
    expect(resolveReframePlan({ aspectRatio: '9:16' })).toEqual({
      aspect: '9:16',
      anchor: 'center',
    });
    expect(defaultReframeAnchor({ aspectRatio: '1:1' })).toBe('center');
  });

  it('uses a top-third anchor for lipsync portrait crops', () => {
    expect(
      resolveReframePlan({
        aspectRatio: '9:16',
        assetPlanKind: 'lipsync',
      }),
    ).toEqual({
      aspect: '9:16',
      anchor: 'top-third',
    });
  });

  it('honors matching per-scene overrides and clamps offsets', () => {
    expect(
      resolveReframePlan({
        aspectRatio: '4:5',
        override: {
          aspect: '4:5',
          anchor: 'right',
          offsetPx: 8000,
        },
      }),
    ).toEqual({
      aspect: '4:5',
      anchor: 'right',
      offsetPx: 5000,
    });
  });

  it('builds cover-and-crop FFmpeg filters with safe crop expressions', () => {
    expect(
      buildReframeCropFilters(
        { width: 1080, height: 1920 },
        { aspect: '9:16', anchor: 'top-third' },
      ),
    ).toEqual([
      'scale=1080:1920:force_original_aspect_ratio=increase',
      'crop=1080:1920:min(max((iw-ow)/2\\,0)\\,iw-ow):min(max((ih-oh)/3\\,0)\\,ih-oh)',
    ]);
  });
});
