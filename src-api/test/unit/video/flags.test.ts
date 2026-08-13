import { afterEach, describe, expect, it, vi } from 'vitest';

import * as ops from '@/shared/db/operations';
import {
  getVideoFeatureFlag,
  snapshotVideoFeatureFlags,
} from '@/shared/video/flags';

// Slice K — flags flipped to on-by-default (kill-switch semantics).

vi.mock('@/shared/db/operations', async (orig) => {
  const actual = await orig<typeof import('@/shared/db/operations')>();
  return { ...actual, getSetting: vi.fn() };
});

const getSetting = vi.mocked(ops.getSetting);

afterEach(() => vi.clearAllMocks());

describe('video feature flags (on by default)', () => {
  it('is enabled when the setting is unset', () => {
    getSetting.mockReturnValue(null);
    expect(getVideoFeatureFlag('video.engine.html')).toBe(true);
    expect(getVideoFeatureFlag('video.contentGraph')).toBe(true);
    expect(getVideoFeatureFlag('video.templateGallery')).toBe(true);
    expect(getVideoFeatureFlag('video.sourceIngestion')).toBe(true);
    expect(getVideoFeatureFlag('video.plugins')).toBe(true);
    expect(getVideoFeatureFlag('video.frameSearch')).toBe(false);
    expect(getVideoFeatureFlag('video.agentApply')).toBe(false);
    expect(getVideoFeatureFlag('video.timelineTransitions')).toBe(true);
    expect(getVideoFeatureFlag('video.webcodecsPreview')).toBe(true);
    expect(getVideoFeatureFlag('video.vividOverlays')).toBe(true);
  });

  it('is enabled when explicitly "true"', () => {
    getSetting.mockReturnValue('true');
    expect(getVideoFeatureFlag('video.engine.html')).toBe(true);
    expect(getVideoFeatureFlag('video.frameSearch')).toBe(true);
    expect(getVideoFeatureFlag('video.agentApply')).toBe(true);
    expect(getVideoFeatureFlag('video.timelineTransitions')).toBe(true);
    expect(getVideoFeatureFlag('video.webcodecsPreview')).toBe(true);
    expect(getVideoFeatureFlag('video.vividOverlays')).toBe(true);
  });

  it('is the kill switch only when explicitly "false"', () => {
    getSetting.mockReturnValue('false');
    expect(getVideoFeatureFlag('video.engine.html')).toBe(false);
    expect(getVideoFeatureFlag('video.webcodecsPreview')).toBe(false);
    expect(getVideoFeatureFlag('video.vividOverlays')).toBe(false);
  });

  it('snapshots all flags', () => {
    getSetting.mockImplementation((k) =>
      k === 'video.sourceIngestion' ? 'false' : null,
    );
    expect(snapshotVideoFeatureFlags()).toEqual({
      'video.engine.html': true,
      'video.contentGraph': true,
      'video.templateGallery': true,
      'video.sourceIngestion': false,
      'video.plugins': true,
      'video.frameSearch': false,
      'video.agentApply': false,
      'video.timelineTransitions': true,
      'video.webcodecsPreview': true,
      'video.vividOverlays': true,
    });
  });
});
