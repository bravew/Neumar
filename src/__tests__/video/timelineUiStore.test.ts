import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';

describe('useTimelineUiStore', () => {
  beforeEach(() => {
    useTimelineUiStore.setState({
      hoverMs: null,
      playheadMs: 0,
      playheadUpdateSource: 'external',
      playbackState: 'stopped',
      pixelsPerSecond: 100,
      scrollX: 0,
      viewportWidth: 800,
      selectedTrackId: null,
    });
  });

  it('tracks whether playhead updates came from preview playback', () => {
    useTimelineUiStore.getState().setPlayheadMs(123.4, { source: 'preview' });

    expect(useTimelineUiStore.getState()).toMatchObject({
      playheadMs: 123,
      playheadUpdateSource: 'preview',
    });

    useTimelineUiStore.getState().setPlayheadMs(500);

    expect(useTimelineUiStore.getState()).toMatchObject({
      playheadMs: 500,
      playheadUpdateSource: 'external',
    });
  });

  it('tracks hover time separately from the committed playhead', () => {
    useTimelineUiStore.getState().setPlayheadMs(1000);

    useTimelineUiStore.getState().setHoverMs(1234.6);

    expect(useTimelineUiStore.getState()).toMatchObject({
      hoverMs: 1235,
      playheadMs: 1000,
      playheadUpdateSource: 'external',
    });

    useTimelineUiStore.getState().setHoverMs(null);

    expect(useTimelineUiStore.getState()).toMatchObject({
      hoverMs: null,
      playheadMs: 1000,
    });
  });

  it('marks pixel seeks and stop actions as external timeline intents', () => {
    useTimelineUiStore.getState().setPlayheadMs(750, { source: 'preview' });

    useTimelineUiStore.getState().seekToPixel(50);

    expect(useTimelineUiStore.getState()).toMatchObject({
      playheadMs: 500,
      playheadUpdateSource: 'external',
    });

    useTimelineUiStore.getState().setPlayheadMs(750, { source: 'preview' });
    useTimelineUiStore.getState().stop();

    expect(useTimelineUiStore.getState()).toMatchObject({
      playheadMs: 0,
      playheadUpdateSource: 'external',
      playbackState: 'stopped',
    });
  });

  it('zooms out and fits multi-minute timelines below the old 25 percent floor', () => {
    useTimelineUiStore.setState({
      pixelsPerSecond: 20,
      scrollX: 320,
      viewportWidth: 800,
    });

    useTimelineUiStore.getState().zoomOut();

    expect(useTimelineUiStore.getState().pixelsPerSecond).toBeLessThan(20);

    useTimelineUiStore.getState().zoomToFit(167_491);

    expect(useTimelineUiStore.getState()).toMatchObject({
      scrollX: 0,
    });
    expect(useTimelineUiStore.getState().pixelsPerSecond).toBeCloseTo(3.821);
  });
});
