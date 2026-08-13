import { describe, expect, it } from 'vitest';

import {
  compareTimelineRows,
  getProjectTimeline,
} from '@/components/video/timeline/projectTimeline';
import {
  clampTimelineZoom,
  formatTimelineTime,
  getVisibleTimeRange,
  getWaveformBarFraction,
  msToPixels,
  pixelsToMs,
  snapMsToFrame,
  TIMELINE_ZOOM,
  zoomToFitTimeline,
} from '@/components/video/timeline/timelineMath';
import type { VideoProject, VideoTimelineTrack } from '@/shared/types/video';

describe('timeline math', () => {
  it('converts between milliseconds and pixels using clamped zoom helpers', () => {
    expect(msToPixels(2500, 80)).toBe(200);
    expect(pixelsToMs(200, 80)).toBe(2500);
    expect(clampTimelineZoom(0.1)).toBe(TIMELINE_ZOOM.MIN);
    expect(clampTimelineZoom(10_000)).toBe(TIMELINE_ZOOM.MAX);
  });

  it('derives visible ranges, fit zoom, and display timecodes', () => {
    expect(
      getVisibleTimeRange({
        scrollX: 160,
        viewportWidth: 320,
        pixelsPerSecond: 80,
      }),
    ).toEqual({ startMs: 2000, endMs: 6000 });
    expect(zoomToFitTimeline(10_000, 960)).toBe(80);
    expect(zoomToFitTimeline(167_491, 800)).toBeLessThan(20);
    expect(zoomToFitTimeline(480_000, 520)).toBeCloseTo(0.75);
    expect(formatTimelineTime(65_432)).toBe('1:05.4');
  });

  it('snaps hover times to valid timeline frames', () => {
    expect(snapMsToFrame(101, 30, 10_000)).toBe(100);
    expect(snapMsToFrame(118, 30, 10_000)).toBe(133);
    expect(snapMsToFrame(-250, 30, 10_000)).toBe(0);
    expect(snapMsToFrame(11_000, 30, 10_000)).toBe(10_000);
    expect(snapMsToFrame(500, 0, 10_000)).toBe(0);
  });

  it('uses the log waveform curve from the plan reference', () => {
    expect(getWaveformBarFraction(0)).toBe(0);
    expect(getWaveformBarFraction(0.001)).toBe(0);
    expect(getWaveformBarFraction(0.5)).toBeGreaterThan(0.5);
    expect(getWaveformBarFraction(1)).toBe(1);
  });

  it('promotes storyboard-only projects into a previewable timeline', () => {
    const timeline = getProjectTimeline(projectFixture());

    expect(timeline).toMatchObject({
      schema: 'neuma.video.timeline.v1',
      durationMs: 4000,
      fps: 30,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          clips: [
            {
              id: 'clip-scene-scene-1',
              startMs: 0,
              durationMs: 4000,
              sourceRef: { kind: 'asset', assetId: 'asset-1' },
            },
          ],
        },
      ],
    });
  });

  it('normalizes saved timelines whose duration is shorter than their clips', () => {
    const project = projectFixture();
    project.timeline = {
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
              sourceRef: { kind: 'asset', assetId: 'asset-1' },
              startMs: 32,
              durationMs: 37_314,
              trimStartMs: 0,
              trimEndMs: 37_314,
              sourceDurationMs: 37_314,
            },
          ],
        },
      ],
    };

    expect(getProjectTimeline(project).durationMs).toBe(37_346);
  });

  it('orders timeline rows like a layer stack', () => {
    const tracks: VideoTimelineTrack[] = [
      trackFixture('track-video-main', 'video', 0),
      trackFixture('track-audio', 'audio-music', 20),
      trackFixture('track-overlay', 'overlay', 10),
      trackFixture('track-caption', 'caption', 30),
      trackFixture('track-video-top', 'video', 20),
    ];

    expect(tracks.sort(compareTimelineRows).map((track) => track.id)).toEqual([
      'track-caption',
      'track-video-top',
      'track-overlay',
      'track-video-main',
      'track-audio',
    ]);
  });
});

function trackFixture(
  id: string,
  kind: VideoTimelineTrack['kind'],
  order: number,
): VideoTimelineTrack {
  return {
    id,
    kind,
    name: id,
    muted: false,
    locked: false,
    order,
    clips: [],
  } as VideoTimelineTrack;
}

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Timeline',
    template: 'explainer',
    prompt: '',
    assets: [
      {
        id: 'asset-1',
        kind: 'video',
        source: 'user',
        path: 'videos/project-1/assets/video.mp4',
        metadata: { durationMs: 4000, frameRate: 29.97 },
      },
    ],
    storyboard: {
      status: 'approved',
      intent: 'Timeline',
      totalDurationMs: 4000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 4000,
          intent: 'Opening',
          assetPlan: { kind: 'existing', assetId: 'asset-1' },
        },
      ],
    },
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}
