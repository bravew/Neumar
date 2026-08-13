import { useMemo } from 'react';

interface CanvasLike {
  getContext: (contextId: string) => unknown;
}

interface DocumentLike {
  createElement: (tagName: 'canvas') => CanvasLike;
}

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

export interface WebCodecsCapabilitySource {
  AudioContext?: unknown;
  AudioDecoder?: unknown;
  OffscreenCanvas?: unknown;
  VideoDecoder?: unknown;
  VideoFrame?: unknown;
  webkitAudioContext?: unknown;
  document?: DocumentLike;
  navigator?: NavigatorLike;
}

export interface WebCodecsCapabilities {
  audioDecoder: boolean;
  audioFallbackAvailable: boolean;
  canvas2d: boolean;
  isLinux: boolean;
  reason: string | null;
  supported: boolean;
  videoDecoder: boolean;
  videoFrame: boolean;
  videoOk: boolean;
  webgl2: boolean;
}

export function useWebCodecsCapabilities(): WebCodecsCapabilities {
  return useMemo(() => detectWebCodecsCapabilities(), []);
}

export function detectWebCodecsCapabilities(
  source: WebCodecsCapabilitySource = globalThis as WebCodecsCapabilitySource,
): WebCodecsCapabilities {
  const canvas = source.document?.createElement('canvas');
  const canvas2d = Boolean(canvas?.getContext('2d'));
  const webgl2 = Boolean(canvas?.getContext('webgl2'));
  const videoDecoder = typeof source.VideoDecoder !== 'undefined';
  const videoFrame = typeof source.VideoFrame !== 'undefined';
  const audioDecoder = typeof source.AudioDecoder !== 'undefined';
  const audioFallbackAvailable =
    typeof source.AudioContext !== 'undefined' ||
    typeof source.webkitAudioContext !== 'undefined';
  const isLinux = detectLinux(source.navigator);
  const videoOk = videoDecoder && videoFrame;
  const audioOk = audioDecoder || audioFallbackAvailable;
  const reason = getUnsupportedReason({
    audioOk,
    canvas2d,
    isLinux,
    videoOk,
  });

  return {
    audioDecoder,
    audioFallbackAvailable,
    canvas2d,
    isLinux,
    reason,
    supported: reason === null,
    videoDecoder,
    videoFrame,
    videoOk,
    webgl2,
  };
}

function detectLinux(navigatorLike: NavigatorLike | undefined): boolean {
  const platform =
    navigatorLike?.userAgentData?.platform ??
    navigatorLike?.platform ??
    navigatorLike?.userAgent ??
    '';
  return /\bLinux\b/i.test(platform);
}

function getUnsupportedReason({
  audioOk,
  canvas2d,
  isLinux,
  videoOk,
}: {
  audioOk: boolean;
  canvas2d: boolean;
  isLinux: boolean;
  videoOk: boolean;
}): string | null {
  if (isLinux) return 'linux unsupported';
  if (!videoOk) return 'WebCodecs video unavailable';
  if (!canvas2d) return 'Canvas2D unavailable';
  if (!audioOk) return 'Web Audio unavailable';
  return null;
}
