import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TransitionInspectorPanel } from '@/components/video/clipInspector/TransitionInspectorPanel';
import { TransitionParamControls } from '@/components/video/clipInspector/TransitionParamControls';
import { timelineTransitionSeamId } from '@/components/video/timeline/timelineTransitions';
import { en } from '@/config/locale';
import { LanguageProvider } from '@/shared/providers/language-provider';
import {
  VIDEO_TRANSITION_REGISTRY,
  type VideoTimeline,
  type VideoTransitionParamDef,
  type VideoTransitionKind,
} from '@/shared/types/video';

describe('TransitionInspectorPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => JSON.stringify({ language: 'en-US' })),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    });
    vi.stubGlobal('matchMedia', () => ({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (contextId: string) => {
        if (contextId !== '2d') return null;
        return canvasContextStub() as unknown as CanvasRenderingContext2D;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('edits duration and type for the selected seam', () => {
    const onUpdate = vi.fn();
    const onPreviewSeek = vi.fn();
    const seamId = timelineTransitionSeamId('track-video', 'clip-1', 'clip-2');

    const { container } = render(
      <TransitionInspectorPanel
        timeline={timelineFixture()}
        seamId={seamId}
        labels={en.video.editor.clipInspector}
        transitionNames={transitionNames()}
        renderLabels={{
          remotionOnly: en.video.editor.timeline.remotionOnly,
          ffmpegOnly: en.video.editor.timeline.ffmpegOnly,
        }}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onPreviewSeek={onPreviewSeek}
      />,
    );

    expect(container.querySelector('canvas')).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText('Duration')[1]!, {
      target: { value: '450' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'fade',
      durationMs: 450,
    });
    expect(onPreviewSeek).toHaveBeenLastCalledWith(1000);

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'clock-wipe' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'clock-wipe',
      durationMs: 500,
    });
    expect(onPreviewSeek).toHaveBeenLastCalledWith(1000);

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'cut' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, { kind: 'cut' });
    expect(onPreviewSeek).toHaveBeenLastCalledWith(1000);
  });

  it('uses the new preset default when changing a cut seam to a transition', () => {
    const onUpdate = vi.fn();
    const timeline = timelineFixture();
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video') {
      throw new Error('Expected video track fixture.');
    }
    const firstClip = track.clips[0]!;
    if (firstClip.kind === 'effect') {
      throw new Error('Expected a visual clip fixture.');
    }
    delete firstClip.transitionToNext;
    const seamId = timelineTransitionSeamId('track-video', 'clip-1', 'clip-2');

    render(
      <TransitionInspectorPanel
        timeline={timeline}
        seamId={seamId}
        labels={en.video.editor.clipInspector}
        transitionNames={transitionNames()}
        renderLabels={{
          remotionOnly: en.video.editor.timeline.remotionOnly,
          ffmpegOnly: en.video.editor.timeline.ffmpegOnly,
        }}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'fade' },
    });

    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'fade',
      durationMs: 500,
    });
  });

  it('renders param controls and updates only the selected transition params', () => {
    const onUpdate = vi.fn();
    const onPreviewSeek = vi.fn();
    const timeline = timelineFixture();
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video') {
      throw new Error('Expected video track fixture.');
    }
    const paramsClip = track.clips[0]!;
    if (paramsClip.kind === 'effect') {
      throw new Error('Expected a visual clip fixture.');
    }
    paramsClip.transitionToNext = {
      kind: 'clock-wipe',
      durationMs: 500,
      params: { startAngle: 90 },
    };
    const seamId = timelineTransitionSeamId('track-video', 'clip-1', 'clip-2');

    render(
      <LanguageProvider>
        <TransitionInspectorPanel
          timeline={timeline}
          seamId={seamId}
          labels={en.video.editor.clipInspector}
          transitionNames={transitionNames()}
          renderLabels={{
            remotionOnly: en.video.editor.timeline.remotionOnly,
            ffmpegOnly: en.video.editor.timeline.ffmpegOnly,
          }}
          onUpdate={onUpdate}
          onRemove={vi.fn()}
          onPreviewSeek={onPreviewSeek}
        />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getAllByLabelText('Start angle')[1]!, {
      target: { value: '180' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'clock-wipe',
      durationMs: 500,
      params: { startAngle: 180 },
    });
    expect(onPreviewSeek).toHaveBeenLastCalledWith(1000);

    fireEvent.change(screen.getByLabelText('Sweep'), {
      target: { value: 'counterclockwise' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'clock-wipe',
      durationMs: 500,
      params: { sweep: 'counterclockwise' },
    });

    fireEvent.change(screen.getByLabelText('Center X'), {
      target: { value: '0.25' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'clock-wipe',
      durationMs: 500,
      params: { center: [0.25, 0.5] },
    });

    fireEvent.change(screen.getByLabelText('Edge color'), {
      target: { value: '#ff0000' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'clock-wipe',
      durationMs: 500,
      params: { edgeColor: [1, 0, 0, 1] },
    });

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'fade' },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(seamId, {
      kind: 'fade',
      durationMs: 500,
    });
  });

  it('renders boolean transition param controls', () => {
    const onChange = vi.fn();
    const paramDefs = [
      {
        key: 'reverse',
        type: 'boolean',
        defaultValue: false,
        labelKey: 'transitions.clockWipeSweep',
      },
    ] as const satisfies readonly VideoTransitionParamDef[];

    render(
      <LanguageProvider>
        <TransitionParamControls
          disabled={false}
          labels={en.video.editor.clipInspector}
          paramDefs={paramDefs}
          onChange={onChange}
        />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByLabelText('Sweep'));

    expect(onChange).toHaveBeenLastCalledWith({ reverse: true });
  });
});

function transitionNames(): Record<VideoTransitionKind, string> {
  const messages = en.video.storyboard.transitions as Record<string, string>;
  return Object.fromEntries(
    VIDEO_TRANSITION_REGISTRY.map((entry) => [
      entry.kind,
      messages[entry.labelKey.replace('transitions.', '')] ?? entry.kind,
    ]),
  ) as Record<VideoTransitionKind, string>;
}

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 2000,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips: [
          {
            id: 'clip-1',
            kind: 'video',
            name: 'First',
            sourceRef: { kind: 'scene', sceneId: 'scene-1' },
            sceneId: 'scene-1',
            startMs: 0,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
            sourceDurationMs: 1000,
            transitionToNext: { kind: 'fade', durationMs: 500 },
          },
          {
            id: 'clip-2',
            kind: 'video',
            name: 'Second',
            sourceRef: { kind: 'scene', sceneId: 'scene-2' },
            sceneId: 'scene-2',
            startMs: 1000,
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

function canvasContextStub() {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
  };
}
