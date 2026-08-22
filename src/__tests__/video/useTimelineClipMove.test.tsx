import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineClipMove } from '@/components/video/timeline/useTimelineClipMove';
import type {
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

describe('useTimelineClipMove', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => null),
    });
  });

  it('builds an accepted overlay drop target for compatible tracks', () => {
    const moveClip = vi.fn();
    const scrollElement = buildScrollElement();
    const { result } = renderHook(() =>
      useTimelineClipMove({
        ...clipMoveOptions(scrollElement),
        moveClip,
      }),
    );

    act(() => {
      result.current.handleMovePreview(
        buildPreview({ clientY: 42, deltaMs: 250 }),
      );
    });

    expect(result.current.dropTarget).toEqual({
      trackId: 'track-video-main',
      startMs: 250,
      accepted: true,
    });

    act(() => {
      result.current.handleMoveClip('clip-1', 250, clipFixture, {
        clientX: 100,
        clientY: 42,
      });
    });

    expect(moveClip).toHaveBeenCalledWith(
      'clip-1',
      250,
      clipFixture,
      'track-video-main',
    );
  });

  it('marks incompatible track targets invalid and drops back to the source layer', () => {
    const moveClip = vi.fn();
    const scrollElement = buildScrollElement();
    const { result } = renderHook(() =>
      useTimelineClipMove({
        ...clipMoveOptions(scrollElement),
        moveClip,
      }),
    );

    act(() => {
      result.current.handleMovePreview(
        buildPreview({ clientY: 106, deltaMs: 500 }),
      );
    });

    expect(result.current.dropTarget).toEqual({
      trackId: 'track-audio',
      startMs: 500,
      accepted: false,
    });

    act(() => {
      result.current.handleMoveClip('clip-1', 500, clipFixture, {
        clientX: 100,
        clientY: 106,
      });
    });

    expect(moveClip).toHaveBeenCalledWith(
      'clip-1',
      500,
      clipFixture,
      undefined,
    );
  });
});

function clipMoveOptions(scrollElement: HTMLDivElement) {
  return {
    tracks,
    scrollRef: { current: scrollElement },
    markers: [],
    beatTimesMs: [],
    playheadMs: 0,
    timelineDurationMs: 2000,
    pixelsPerSecond: 80,
    snappingEnabled: false,
    snapTolerancePx: 6,
    selectedClipIds: new Set<string>(),
  };
}

function buildScrollElement(): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: 240,
      height: 240,
      left: 0,
      right: 500,
      top: 0,
      width: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
  return element;
}

function buildPreview({
  clientY,
  deltaMs,
}: {
  clientY: number;
  deltaMs: number;
}) {
  return {
    clip: clipFixture,
    track: tracks[0]!,
    baselineClip: clipFixture,
    deltaMs,
    clientX: 100,
    clientY,
    offsetX: 10,
    offsetY: 8,
    width: 120,
    height: 48,
  };
}

const clipFixture: VideoTimelineClip = {
  id: 'clip-1',
  kind: 'video',
  name: 'Scene 1',
  sourceRef: { kind: 'scene', sceneId: 'scene-1' },
  sceneId: 'scene-1',
  startMs: 0,
  durationMs: 1000,
  trimStartMs: 0,
  trimEndMs: 1000,
  sourceDurationMs: 1000,
};

const tracks: VideoTimelineTrack[] = [
  {
    id: 'track-video-main',
    kind: 'video',
    name: 'Video 1',
    muted: false,
    locked: false,
    hidden: false,
    order: 0,
    clips: [clipFixture],
  },
  {
    id: 'track-audio',
    kind: 'audio-music',
    name: 'Music',
    muted: false,
    locked: false,
    order: 20,
    clips: [],
  },
];
