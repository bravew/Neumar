import { describe, expect, it } from 'vitest';

import {
  detectWebCodecsCapabilities,
  type WebCodecsCapabilitySource,
} from '@/shared/video/useWebCodecsCapabilities';

describe('detectWebCodecsCapabilities', () => {
  it('supports the native WebCodecs happy path', () => {
    const caps = detectWebCodecsCapabilities(capabilitySource());

    expect(caps).toMatchObject({
      audioDecoder: true,
      audioFallbackAvailable: true,
      canvas2d: true,
      isLinux: false,
      reason: null,
      supported: true,
      videoOk: true,
      webgl2: true,
    });
  });

  it('supports macOS-style Web Audio fallback when AudioDecoder is absent', () => {
    const caps = detectWebCodecsCapabilities(
      capabilitySource({ AudioDecoder: undefined }),
    );

    expect(caps.audioFallbackAvailable).toBe(true);
    expect(caps.supported).toBe(true);
    expect(caps.reason).toBeNull();
  });

  it('requires either AudioDecoder or Web Audio', () => {
    const caps = detectWebCodecsCapabilities(
      capabilitySource({
        AudioContext: undefined,
        AudioDecoder: undefined,
        webkitAudioContext: undefined,
      }),
    );

    expect(caps.supported).toBe(false);
    expect(caps.reason).toBe('Web Audio unavailable');
  });

  it('force-disables Linux even when browser features exist', () => {
    const caps = detectWebCodecsCapabilities(
      capabilitySource({
        navigator: { platform: 'Linux x86_64' },
      }),
    );

    expect(caps.supported).toBe(false);
    expect(caps.isLinux).toBe(true);
    expect(caps.reason).toBe('linux unsupported');
  });

  it('reports missing video and canvas capability reasons', () => {
    expect(
      detectWebCodecsCapabilities(capabilitySource({ VideoDecoder: undefined }))
        .reason,
    ).toBe('WebCodecs video unavailable');

    expect(
      detectWebCodecsCapabilities(
        capabilitySource({ document: canvasDocument({ canvas2d: false }) }),
      ).reason,
    ).toBe('Canvas2D unavailable');
  });
});

function capabilitySource(
  overrides: Partial<WebCodecsCapabilitySource> = {},
): WebCodecsCapabilitySource {
  return {
    AudioContext: function AudioContext() {},
    AudioDecoder: function AudioDecoder() {},
    VideoDecoder: function VideoDecoder() {},
    VideoFrame: function VideoFrame() {},
    document: canvasDocument(),
    navigator: { platform: 'MacIntel' },
    ...overrides,
  };
}

function canvasDocument(options?: {
  canvas2d?: boolean;
  webgl2?: boolean;
}): WebCodecsCapabilitySource['document'] {
  const canvas2d = options?.canvas2d ?? true;
  const webgl2 = options?.webgl2 ?? true;
  return {
    createElement: () => ({
      getContext: (contextId) => {
        if (contextId === '2d') return canvas2d ? {} : null;
        if (contextId === 'webgl2') return webgl2 ? {} : null;
        return null;
      },
    }),
  };
}
