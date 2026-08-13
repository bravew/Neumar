import { describe, expect, it } from 'vitest';

import { probeToMediaMetadata } from '@/shared/media/probe';
import type { ProbeResult } from '@/shared/services/ffmpeg';

function baseProbe(raw: Record<string, unknown>): ProbeResult {
  return {
    filePath: '/tmp/x.mp4',
    duration: 8,
    size: 1000,
    bitRate: 0,
    formatName: 'mov,mp4',
    formatLongName: undefined,
    streams: [
      {
        index: 0,
        codecType: 'video',
        codecName: 'h264',
        width: 1920,
        height: 1080,
      },
    ],
    videoStreamCount: 1,
    audioStreamCount: 0,
    subtitleStreamCount: 0,
    raw,
  } as unknown as ProbeResult;
}

describe('probeToMediaMetadata capturedAt', () => {
  it('extracts creation_time from the format tags as ISO', () => {
    const meta = probeToMediaMetadata(
      baseProbe({
        format: { tags: { creation_time: '2025-02-16T19:08:21.000000Z' } },
      }),
    );
    expect(meta.capturedAt).toBe('2025-02-16T19:08:21.000Z');
  });

  it('falls back to a stream creation_time tag', () => {
    const meta = probeToMediaMetadata(
      baseProbe({
        format: { tags: {} },
        streams: [{ tags: { creation_time: '2024-12-01T10:00:00Z' } }],
      }),
    );
    expect(meta.capturedAt).toBe('2024-12-01T10:00:00.000Z');
  });

  it('ignores the 1970 placeholder ffmpeg writes for missing dates', () => {
    const meta = probeToMediaMetadata(
      baseProbe({
        format: { tags: { creation_time: '1970-01-01T00:00:00.000000Z' } },
      }),
    );
    expect(meta.capturedAt).toBeUndefined();
  });

  it('is undefined when no creation_time tag is present', () => {
    const meta = probeToMediaMetadata(baseProbe({ format: { tags: {} } }));
    expect(meta.capturedAt).toBeUndefined();
  });
});

describe('probeToMediaMetadata gps', () => {
  it('parses an ISO-6709 location tag (lat/lng)', () => {
    const meta = probeToMediaMetadata(
      baseProbe({ format: { tags: { location: '+37.7858-122.4064/' } } }),
    );
    expect(meta.gps).toEqual({ lat: 37.7858, lng: -122.4064 });
  });

  it('parses the QuickTime ISO-6709 tag and ignores altitude', () => {
    const meta = probeToMediaMetadata(
      baseProbe({
        format: {
          tags: {
            'com.apple.quicktime.location.ISO6709': '+27.5916+086.5640+8850/',
          },
        },
      }),
    );
    expect(meta.gps).toEqual({ lat: 27.5916, lng: 86.564 });
  });

  it('is undefined when no location tag is present', () => {
    const meta = probeToMediaMetadata(baseProbe({ format: { tags: {} } }));
    expect(meta.gps).toBeUndefined();
  });
});
