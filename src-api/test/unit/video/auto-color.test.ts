import { describe, expect, it } from 'vitest';

import type { ProbeResult } from '@/shared/services/ffmpeg';
import {
  autoColorFilter,
  buildVideoColorFilters,
  colorMetadataFromProbe,
  HDR_TO_SDR_FILTER,
  isHdrVideo,
  summarizeColorManagement,
} from '@/shared/video/auto-color';

describe('video auto color', () => {
  it('detects HDR transfer, primaries, and color spaces', () => {
    expect(isHdrVideo({ colorTransfer: 'smpte2084' })).toBe(true);
    expect(isHdrVideo({ colorTransfer: 'arib-std-b67' })).toBe(true);
    expect(isHdrVideo({ colorPrimaries: 'bt2020' })).toBe(true);
    expect(isHdrVideo({ colorSpace: 'bt2020nc' })).toBe(true);
    expect(
      isHdrVideo({ colorTransfer: 'bt709', colorPrimaries: 'bt709' }),
    ).toBe(false);
  });

  it('extracts normalized color metadata from probe streams', () => {
    expect(colorMetadataFromProbe(probeFixture())).toEqual({
      colorTransfer: 'smpte2084',
      colorPrimaries: 'bt2020',
      colorSpace: 'bt2020nc',
      pixelFormat: 'yuv420p10le',
    });
  });

  it('builds tone-map before the optional conservative auto grade', () => {
    expect(
      buildVideoColorFilters({
        color: { colorTransfer: 'smpte2084' },
        autoColorFilter: autoColorFilter(true),
      }),
    ).toEqual([
      HDR_TO_SDR_FILTER,
      'eq=contrast=1.1:brightness=0.02:saturation=1.05',
    ]);
    expect(
      buildVideoColorFilters({ color: { colorTransfer: 'bt709' } }),
    ).toEqual([]);
  });

  it('summarizes render output color management when tone mapping applies', () => {
    expect(
      summarizeColorManagement([
        { color: { colorTransfer: 'bt709' } },
        { color: { colorTransfer: 'arib-std-b67' } },
      ]),
    ).toEqual({
      inputTransfer: 'arib-std-b67',
      outputColorSpace: 'bt709',
      toneMapped: true,
    });
    expect(
      summarizeColorManagement([{ color: { colorTransfer: 'bt709' } }]),
    ).toBeUndefined();
  });
});

function probeFixture(): ProbeResult {
  return {
    filePath: '',
    duration: 10,
    size: 1_000_000,
    bitRate: 1_000_000,
    formatName: 'mov,mp4',
    streams: [
      {
        index: 0,
        codecType: 'video',
        codecName: 'h264',
        pixelFormat: 'yuv420p10le',
        colorTransfer: 'SMPTE2084',
        colorPrimaries: 'BT2020',
        colorSpace: 'BT2020NC',
      },
    ],
    videoStreamCount: 1,
    audioStreamCount: 0,
    subtitleStreamCount: 0,
    raw: {},
  };
}
