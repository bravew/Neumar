import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KeyframeSection } from '@/components/video/clipInspector/KeyframeSection';
import videoMessages from '@/config/locale/messages/en/video';
import type { VideoVisualTimelineClip } from '@/shared/types/video';

const labels = videoMessages.editor.clipInspector;

describe('KeyframeSection', () => {
  it('adds a keyframe at the playhead with the current property value', () => {
    const updateClip = vi.fn();
    render(
      <KeyframeSection
        clip={clipFixture}
        labels={labels}
        playheadMs={250}
        updateClip={updateClip}
      />,
    );

    fireEvent.click(screen.getByText(labels.keyframeAddAtPlayhead));

    expect(updateClip).toHaveBeenCalledWith({
      keyframes: [
        {
          property: 'opacity',
          keys: [{ atMs: 250, value: 1, interp: 'linear' }],
        },
      ],
    });
  });

  it('updates and deletes existing keyframes', () => {
    const updateClip = vi.fn();
    const clip: VideoVisualTimelineClip = {
      ...clipFixture,
      keyframes: [
        {
          property: 'opacity',
          keys: [{ atMs: 0, value: 1, interp: 'linear' }],
        },
      ],
    };
    render(
      <KeyframeSection
        clip={clip}
        labels={labels}
        playheadMs={0}
        updateClip={updateClip}
      />,
    );

    fireEvent.change(screen.getByLabelText(labels.keyframeValue), {
      target: { value: '0.5' },
    });

    expect(updateClip).toHaveBeenLastCalledWith({
      keyframes: [
        {
          property: 'opacity',
          keys: [{ atMs: 0, value: 0.5, interp: 'linear' }],
        },
      ],
    });

    fireEvent.click(screen.getByLabelText(labels.keyframeDelete));

    expect(updateClip).toHaveBeenLastCalledWith({ keyframes: undefined });
  });

  it('keeps keyframe times unique when moving a key', () => {
    const updateClip = vi.fn();
    const clip: VideoVisualTimelineClip = {
      ...clipFixture,
      keyframes: [
        {
          property: 'opacity',
          keys: [
            { atMs: 0, value: 1, interp: 'linear' },
            { atMs: 500, value: 0.5, interp: 'smooth' },
          ],
        },
      ],
    };
    render(
      <KeyframeSection
        clip={clip}
        labels={labels}
        playheadMs={0}
        updateClip={updateClip}
      />,
    );

    fireEvent.change(screen.getAllByLabelText(labels.keyframeTime)[0]!, {
      target: { value: '500' },
    });

    expect(updateClip).toHaveBeenLastCalledWith({
      keyframes: [
        {
          property: 'opacity',
          keys: [{ atMs: 500, value: 1, interp: 'linear' }],
        },
      ],
    });
  });
});

const clipFixture: VideoVisualTimelineClip = {
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
