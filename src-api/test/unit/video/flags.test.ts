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
    expect(getVideoFeatureFlag('video.remotionMedia')).toBe(true);
    expect(getVideoFeatureFlag('video.hostNative')).toBe(true);
  });

  it('is enabled when explicitly "true"', () => {
    getSetting.mockReturnValue('true');
    expect(getVideoFeatureFlag('video.engine.html')).toBe(true);
    expect(getVideoFeatureFlag('video.frameSearch')).toBe(true);
    expect(getVideoFeatureFlag('video.agentApply')).toBe(true);
    expect(getVideoFeatureFlag('video.timelineTransitions')).toBe(true);
    expect(getVideoFeatureFlag('video.webcodecsPreview')).toBe(true);
    expect(getVideoFeatureFlag('video.vividOverlays')).toBe(true);
    expect(getVideoFeatureFlag('video.remotionMedia')).toBe(true);
  });

  it('is the kill switch only when explicitly "false"', () => {
    getSetting.mockReturnValue('false');
    expect(getVideoFeatureFlag('video.engine.html')).toBe(false);
    expect(getVideoFeatureFlag('video.webcodecsPreview')).toBe(false);
    expect(getVideoFeatureFlag('video.vividOverlays')).toBe(false);
    expect(getVideoFeatureFlag('video.remotionMedia')).toBe(false);
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
      'video.referenceAnalysis': true,
      'video.referenceSemanticReading': true,
      'video.plugins': true,
      'video.frameSearch': false,
      'video.agentApply': false,
      'video.timelineTransitions': true,
      'video.webcodecsPreview': true,
      'video.vividOverlays': true,
      'video.remotionMedia': true,
      'video.hostNative': true,
      // Off by default: multicamera is opt-in until the review surface lands,
      // and audio-correlation sync until its accuracy is measured.
      'video.multicam': false,
      'video.multicamAudioSync': false,
    });
  });
});

describe.each([
  'video.referenceAnalysis',
  'video.referenceSemanticReading',
] as const)('%s kill switch', (flag) => {
  it.each([null, '', 'true', 'FALSE'])('defaults on for %s', (setting) => {
    getSetting.mockReturnValue(setting);
    expect(getVideoFeatureFlag(flag)).toBe(true);
    expect(snapshotVideoFeatureFlags()[flag]).toBe(true);
  });

  it('preserves explicit opt-out without disabling the other flag', () => {
    getSetting.mockImplementation((key) => (key === flag ? 'false' : null));
    expect(getVideoFeatureFlag(flag)).toBe(false);
    const other =
      flag === 'video.referenceAnalysis'
        ? 'video.referenceSemanticReading'
        : 'video.referenceAnalysis';
    expect(snapshotVideoFeatureFlags()[flag]).toBe(false);
    expect(getVideoFeatureFlag(other)).toBe(true);
  });
});
