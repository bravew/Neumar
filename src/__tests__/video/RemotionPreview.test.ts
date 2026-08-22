import { createElement } from 'react';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getRemotionFrameForMs,
  RemotionPreview,
  shouldApplyExternalPlayheadSeek,
} from '@/components/video/preview/RemotionPreview';
import type { RemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import type {
  VideoProject,
  VideoTimeline,
  VideoTimelineTransition,
} from '@/shared/types/video';

const playerProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@remotion/player', async () => {
  const React = await import('react');
  return {
    Player: React.forwardRef(function MockPlayer(
      props: Record<string, unknown>,
      ref,
    ) {
      playerProps.push(props);
      React.useImperativeHandle(ref, () => ({
        addEventListener: vi.fn(),
        exitFullscreen: vi.fn(),
        isFullscreen: vi.fn(() => false),
        pause: vi.fn(),
        play: vi.fn(),
        removeEventListener: vi.fn(),
        seekTo: vi.fn(),
        toggle: vi.fn(),
      }));
      return React.createElement('div', { 'data-testid': 'remotion-player' });
    }),
  };
});

afterEach(() => {
  cleanup();
  playerProps.length = 0;
  useTimelineEditorStore.setState({
    projectId: null,
    timeline: null,
  });
});

describe('RemotionPreview playhead sync', () => {
  it('ignores preview-originated playhead updates to avoid seek feedback', () => {
    expect(
      shouldApplyExternalPlayheadSeek({
        playheadUpdateSource: 'preview',
        lastSyncedFrame: 120,
        targetFrame: 90,
      }),
    ).toBe(false);
  });

  it('uses the stored playhead for the first preview mount', () => {
    expect(
      shouldApplyExternalPlayheadSeek({
        playheadUpdateSource: 'preview',
        lastSyncedFrame: null,
        targetFrame: 90,
      }),
    ).toBe(true);
  });

  it('applies external timeline seeks when the target frame changed', () => {
    expect(
      shouldApplyExternalPlayheadSeek({
        playheadUpdateSource: 'external',
        lastSyncedFrame: 120,
        targetFrame: 90,
      }),
    ).toBe(true);
    expect(
      shouldApplyExternalPlayheadSeek({
        playheadUpdateSource: 'external',
        lastSyncedFrame: 90,
        targetFrame: 90,
      }),
    ).toBe(false);
  });

  it('maps milliseconds to valid Remotion frames', () => {
    expect(
      getRemotionFrameForMs({ durationInFrames: 120, fps: 30, ms: 1000 }),
    ).toBe(30);
    expect(
      getRemotionFrameForMs({ durationInFrames: 120, fps: 30, ms: -100 }),
    ).toBe(0);
    expect(
      getRemotionFrameForMs({ durationInFrames: 120, fps: 30, ms: 10_000 }),
    ).toBe(119);
  });

  it('rebuilds Player input from live editor transition updates', () => {
    const project = projectFixture(clockWipeTransition('clockwise'));

    render(
      createElement(RemotionPreview, {
        aspectRatio: '16:9',
        playbackRate: 1,
        project,
      }),
    );

    expect(latestPlayerData().visualClips[0]?.transitionToNext).toMatchObject({
      kind: 'clock-wipe',
      params: { sweep: 'clockwise' },
    });
    expect(latestPlayerInputProps().useRemotionMedia).toBe(true);

    act(() => {
      useTimelineEditorStore
        .getState()
        .setProjectTimeline(
          project.id,
          projectTimeline(clockWipeTransition('counterclockwise')),
        );
    });

    expect(latestPlayerData().visualClips[0]?.transitionToNext).toMatchObject({
      kind: 'clock-wipe',
      params: { sweep: 'counterclockwise' },
    });
  });
});

function latestPlayerData(): RemotionPreviewData {
  return latestPlayerInputProps().data;
}

function latestPlayerInputProps(): {
  data: RemotionPreviewData;
  useRemotionMedia: boolean;
} {
  const props = playerProps.at(-1);
  if (!props) throw new Error('Expected the mocked Remotion Player to render.');
  return props.inputProps as {
    data: RemotionPreviewData;
    useRemotionMedia: boolean;
  };
}

function clockWipeTransition(
  sweep: 'clockwise' | 'counterclockwise',
): VideoTimelineTransition {
  return {
    durationMs: 700,
    kind: 'clock-wipe',
    params: { sweep },
  };
}

function projectFixture(transition: VideoTimelineTransition): VideoProject {
  return {
    id: 'project-live-preview',
    name: 'Live Preview',
    template: 'explainer',
    prompt: '',
    assets: [
      {
        id: 'asset-a',
        kind: 'video',
        source: 'user',
        path: 'videos/project-live-preview/assets/a.mp4',
        metadata: { durationMs: 4000, frameRate: 30 },
      },
      {
        id: 'asset-b',
        kind: 'video',
        source: 'user',
        path: 'videos/project-live-preview/assets/b.mp4',
        metadata: { durationMs: 4000, frameRate: 30 },
      },
    ],
    storyboard: {
      status: 'approved',
      intent: 'Live Preview',
      totalDurationMs: 4000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [],
    },
    timeline: projectTimeline(transition),
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
}

function projectTimeline(transition: VideoTimelineTransition): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 4000,
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
            id: 'clip-a',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-a' },
            startMs: 0,
            durationMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
            sourceDurationMs: 4000,
            transitionToNext: transition,
          },
          {
            id: 'clip-b',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-b' },
            startMs: 2000,
            durationMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
            sourceDurationMs: 4000,
          },
        ],
      },
    ],
  };
}
