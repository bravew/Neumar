import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineClip } from '@/components/video/timeline/TimelineClip';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import type {
  VideoAudioTimelineClip,
  VideoMediaItem,
  VideoTimeline,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

describe('TimelineClip', () => {
  beforeEach(() => {
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    useTimelineUiStore.setState({ playheadMs: 0, razorToolEnabled: false });
    useTimelineEditorStore.setState({
      projectId: null,
      timeline: null,
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      lastSelectedClipId: null,
      selectedMarkerId: null,
      lastEditWarning: null,
      userHistory: [],
      userHistoryIndex: 0,
      revision: 0,
      persistedRevision: 0,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        fillStyle: '',
      })),
    });
  });

  it('selects on click without finalizing a clip move', () => {
    const onMoveClip = vi.fn();
    const onSelect = vi.fn();
    render(
      <TimelineClip
        clip={clipFixture}
        track={trackFixture}
        projectId="test-project"
        pixelsPerSecond={10}
        selected={false}
        linkedPartner={false}
        labels={clipLabels}
        onSelect={onSelect}
        onTrimClip={vi.fn()}
        onMoveClip={onMoveClip}
      />,
    );

    const clip = screen.getByRole('button', { name: /scene 1/i });
    fireEvent.pointerDown(clip, {
      pointerId: 1,
      button: 0,
      clientX: 20,
      clientY: 80,
    });
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('grabbing');
    fireEvent.pointerUp(clip, { pointerId: 1, clientX: 20, clientY: 80 });

    expect(onSelect).toHaveBeenCalledWith(clipFixture, { mode: 'replace' });
    expect(onMoveClip).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('uses the razor tool to split the clicked clip at the pointer time', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('test-project', timelineFixture);
    useTimelineUiStore.setState({ razorToolEnabled: true });
    const splitSpy = vi.spyOn(
      useTimelineEditorStore.getState(),
      'splitSelectedClipAtPlayhead',
    );
    const onMoveClip = vi.fn();
    const onSelect = vi.fn();
    render(
      <TimelineClip
        clip={clipFixture}
        track={trackFixture}
        projectId="test-project"
        pixelsPerSecond={10}
        selected={false}
        linkedPartner={false}
        labels={clipLabels}
        onSelect={onSelect}
        onTrimClip={vi.fn()}
        onMoveClip={onMoveClip}
      />,
    );

    const clip = screen.getByRole('button', { name: /scene 1/i });
    vi.spyOn(clip, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      right: 110,
      top: 0,
      bottom: 40,
      width: 100,
      height: 40,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(clip, {
      pointerId: 1,
      button: 0,
      clientX: 15,
      clientY: 80,
    });

    expect(useTimelineUiStore.getState().playheadMs).toBe(500);
    expect(splitSpy).toHaveBeenCalledWith(500);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onMoveClip).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  it('uses the asset display name for generated catalog clip names', () => {
    const clip: VideoTimelineClip = {
      ...clipFixture,
      id: 'clip-catalog',
      name: 'catalog-651359cb-20260529_133714.jpg',
      sourceRef: { kind: 'asset', assetId: 'asset-1' },
    };
    render(
      <TimelineClip
        clip={clip}
        track={trackFixture}
        asset={assetFixture}
        projectId="test-project"
        pixelsPerSecond={10}
        selected={false}
        linkedPartner={false}
        labels={clipLabels}
        onSelect={vi.fn()}
        onTrimClip={vi.fn()}
        onMoveClip={vi.fn()}
      />,
    );

    const renderedClip = screen.getByRole('button', {
      name: /20260529_133714\.jpg/i,
    });
    expect(renderedClip).toHaveAttribute('title', '20260529_133714.jpg');
    expect(screen.queryByText(/catalog-651359cb/i)).not.toBeInTheDocument();
  });

  it('nudges a focused clip with Alt+Arrow keys', () => {
    vi.useFakeTimers();
    const onMoveClip = vi.fn();
    const onSelect = vi.fn();
    try {
      render(
        <TimelineClip
          clip={clipFixture}
          track={trackFixture}
          projectId="test-project"
          pixelsPerSecond={10}
          selected={true}
          linkedPartner={false}
          labels={clipLabels}
          onSelect={onSelect}
          onTrimClip={vi.fn()}
          onMoveClip={onMoveClip}
        />,
      );

      const clip = screen.getByRole('button', {
        name: /Alt\+Left\/Right nudges clip/i,
      });

      expect(clip).toHaveAttribute(
        'aria-keyshortcuts',
        'Alt+ArrowLeft Alt+ArrowRight',
      );
      expect(clip).toHaveAttribute('aria-grabbed', 'true');

      fireEvent.keyDown(clip, { key: 'ArrowRight', altKey: true });

      expect(onSelect).toHaveBeenCalledWith(clipFixture);
      expect(onMoveClip).toHaveBeenCalledWith('clip-1', 100, clipFixture);
      expect(screen.getByText('Scene 1 starts at 0.1s.')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(
        screen.queryByText('Scene 1 starts at 0.1s.'),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows audio clip badges and fade handles', () => {
    const clip: VideoAudioTimelineClip = {
      id: 'clip-audio',
      kind: 'audio',
      name: 'Voiceover',
      sourceRef: { kind: 'asset', assetId: 'asset-audio' },
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 250,
      trimEndMs: 1250,
      sourceDurationMs: 2000,
      gainDb: 4.5,
      muted: true,
      fadeInMs: 120,
      fadeOutMs: 80,
      audioTransitionToNext: {
        kind: 'crossfade',
        durationMs: 200,
        curve: 'equal-power',
      },
    };
    const track: VideoTimelineTrack = {
      id: 'track-audio',
      kind: 'audio-vo',
      name: 'Voice',
      muted: false,
      locked: false,
      order: 0,
      clips: [clip],
    };
    render(
      <TimelineClip
        clip={clip}
        track={track}
        projectId="test-project"
        pixelsPerSecond={10}
        selected={false}
        linkedPartner={false}
        labels={clipLabels}
        onSelect={vi.fn()}
        onTrimClip={vi.fn()}
        onMoveClip={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Audio clip muted')).toBeInTheDocument();
    expect(screen.getByLabelText('Audio gain +4.5 dB')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Audio fade 120 ms in / 80 ms out'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Audio transition 200 ms'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Adjust audio fade in' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Adjust audio fade out' }),
    ).toBeInTheDocument();
  });

  it('finalizes a clip move after the drag threshold is crossed', () => {
    const onMoveClip = vi.fn();
    const onMovePreview = vi.fn();
    const onMovePreviewEnd = vi.fn();
    render(
      <TimelineClip
        clip={clipFixture}
        track={trackFixture}
        projectId="test-project"
        pixelsPerSecond={10}
        selected={false}
        linkedPartner={false}
        labels={clipLabels}
        onSelect={vi.fn()}
        onTrimClip={vi.fn()}
        onMoveClip={onMoveClip}
        onMovePreview={onMovePreview}
        onMovePreviewEnd={onMovePreviewEnd}
      />,
    );

    const clip = screen.getByRole('button', { name: /scene 1/i });
    expect(clip).toHaveClass('cursor-grab');
    fireEvent.pointerDown(clip, {
      pointerId: 1,
      button: 0,
      clientX: 20,
      clientY: 80,
    });
    fireEvent.pointerMove(clip, { pointerId: 1, clientX: 27, clientY: 80 });
    expect(clip).toHaveClass('cursor-grabbing');
    expect(onMoveClip).not.toHaveBeenCalled();
    expect(onMovePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineClip: clipFixture,
        clip: clipFixture,
        clientX: 27,
        clientY: 80,
        deltaMs: 700,
        track: trackFixture,
      }),
    );
    fireEvent.pointerUp(clip, { pointerId: 1, clientX: 27, clientY: 80 });

    expect(onMoveClip).toHaveBeenCalledOnce();
    expect(onMoveClip).toHaveBeenLastCalledWith('clip-1', 700, clipFixture, {
      clientX: 27,
      clientY: 80,
      disableSnap: false,
    });
    expect(onMovePreviewEnd).toHaveBeenCalledOnce();
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });
});

const clipLabels = {
  trimStart: 'Trim start',
  trimEnd: 'Trim end',
  linkedClip: 'Linked group {group}',
  keyframedClip: 'Keyframed clip',
  captionGroup: 'Caption group {group}',
  audioMutedClip: 'Audio clip muted',
  audioGainClip: 'Audio gain {gain} dB',
  audioFadeClip: 'Audio fade {in} ms in / {out} ms out',
  audioTransitionClip: 'Audio transition {duration} ms',
  audioFadeInHandle: 'Adjust audio fade in',
  audioFadeOutHandle: 'Adjust audio fade out',
  keyboardMoveHint: 'Alt+Left/Right nudges clip; Shift moves farther.',
  keyboardMoveAnnouncement: '{name} starts at {time}.',
};

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

const trackFixture: VideoTimelineTrack = {
  id: 'track-video-2',
  kind: 'video',
  name: 'Video 2',
  muted: false,
  locked: false,
  hidden: false,
  order: 10,
  clips: [clipFixture],
};

const timelineFixture: VideoTimeline = {
  schema: 'neuma.video.timeline.v1',
  fps: 30,
  durationMs: 1000,
  tracks: [trackFixture],
};

const assetFixture: VideoMediaItem = {
  id: 'asset-1',
  kind: 'image',
  source: 'downloaded',
  path: 'videos/test-project/assets/catalog-651359cb-20260529_133714.jpg',
  metadata: {
    durationMs: 5000,
    width: 4000,
    height: 3000,
    fileSize: 4126949,
  },
  provenance: {
    provider: 'immich',
    sourceDisplayName: '20260529_133714.jpg',
  },
};
