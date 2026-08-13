import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { useTimelinePersistence } from '@/components/video/timeline/useTimelinePersistence';
import type { VideoTimeline } from '@/shared/types/video';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        editor: {
          timeline: {
            saveFailed: 'Timeline changes could not be saved.',
          },
        },
      },
    },
  }),
}));

describe('useTimelinePersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTimelineStore();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    resetTimelineStore();
  });

  it('coalesces a burst of reducer commits into one save', async () => {
    const timeline = timelineFixture();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    const onTimelineChange = vi.fn(
      async (_timeline: VideoTimeline): Promise<null> => null,
    );

    renderHook(() =>
      useTimelinePersistence({
        projectId: 'project-1',
        onTimelineChange,
      }),
    );

    const baselineClip = timeline.tracks[0]!.clips[0]!;
    for (let index = 1; index <= 50; index += 1) {
      act(() => {
        useTimelineEditorStore
          .getState()
          .moveClip('clip-1', index * 10, baselineClip);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4);
      });
    }

    expect(onTimelineChange).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onTimelineChange).toHaveBeenCalledTimes(1);
    const savedTimeline = onTimelineChange.mock.calls[0]?.[0] as VideoTimeline;
    expect(savedTimeline.tracks[0]?.clips[0]).toMatchObject({
      startMs: 500,
    });
    expect(useTimelineEditorStore.getState().persistedRevision).toBe(15);
  });

  it('queues one follow-up save when edits land during an in-flight write', async () => {
    const timeline = timelineFixture();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    const firstSave = deferred<void>();
    const onTimelineChange = vi
      .fn<(timeline: VideoTimeline) => Promise<null>>()
      .mockImplementationOnce(() => firstSave.promise.then(() => null))
      .mockResolvedValue(null);

    renderHook(() =>
      useTimelinePersistence({
        projectId: 'project-1',
        onTimelineChange,
      }),
    );

    const baselineClip = timeline.tracks[0]!.clips[0]!;
    act(() => {
      useTimelineEditorStore.getState().moveClip('clip-1', 100, baselineClip);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onTimelineChange).toHaveBeenCalledTimes(1);

    act(() => {
      useTimelineEditorStore.getState().moveClip('clip-1', 200, baselineClip);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onTimelineChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onTimelineChange).toHaveBeenCalledTimes(2);
    const savedTimeline = onTimelineChange.mock.calls[1]?.[0] as VideoTimeline;
    expect(savedTimeline.tracks[0]?.clips[0]).toMatchObject({
      startMs: 200,
    });
    expect(useTimelineEditorStore.getState().persistedRevision).toBe(2);
  });
});

function resetTimelineStore(): void {
  useTimelineEditorStore.setState({
    projectId: null,
    timeline: null,
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    lastSelectedClipId: null,
    selectedMarkerId: null,
    userHistory: [],
    userHistoryIndex: 0,
    revision: 0,
    persistedRevision: 0,
  });
}

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 1000,
    fps: 30,
    tracks: [
      {
        id: 'track-video-main',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips: [
          {
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
          },
        ],
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
