import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/__tests__/helpers/render-with-providers';
import { Timeline } from '@/components/video/timeline/Timeline';
import { TRACK_HEADER_WIDTH } from '@/components/video/timeline/timelineLayout';
import { zoomToFitTimeline } from '@/components/video/timeline/timelineMath';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import type { VideoProject } from '@/shared/types/video';

describe('Timeline', () => {
  let clientWidthDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );
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
    useTimelineUiStore.setState({
      playheadMs: 0,
      playheadUpdateSource: 'external',
      playbackState: 'stopped',
      pixelsPerSecond: 80,
      scrollX: 320,
      viewportWidth: 800,
      selectedTrackId: null,
    });
  });

  afterEach(() => {
    if (clientWidthDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientWidth',
        clientWidthDescriptor,
      );
      return;
    }
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });

  it('fits the full project duration to the measured timeline width on mount', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => TRACK_HEADER_WIDTH + 1000,
    });

    renderWithProviders(
      <Timeline project={projectFixture()} onTimelineChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(useTimelineUiStore.getState().pixelsPerSecond).toBeCloseTo(
        zoomToFitTimeline(180_000, 1000),
      );
    });
    expect(useTimelineUiStore.getState()).toMatchObject({
      scrollX: 0,
      viewportWidth: 1000,
    });
  });

  it('selects the scene containing the current timeline playhead', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => TRACK_HEADER_WIDTH + 1000,
    });
    const onSelectScene = vi.fn();

    renderWithProviders(
      <Timeline
        project={multiSceneProjectFixture()}
        selectedSceneId="scene-1"
        onSelectScene={onSelectScene}
        onTimelineChange={vi.fn()}
      />,
    );

    act(() => {
      useTimelineUiStore.getState().setPlayheadMs(75_000);
    });

    await waitFor(() => {
      expect(onSelectScene).toHaveBeenCalledWith('scene-2', {
        source: 'timeline',
      });
    });
  });

  it('does not seek back to a scene start for timeline-sourced selection', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => TRACK_HEADER_WIDTH + 1000,
    });
    useTimelineUiStore.setState({ playheadMs: 75_000 });

    renderWithProviders(
      <Timeline
        project={multiSceneProjectFixture()}
        selectedSceneId="scene-2"
        selectedSceneSource="timeline"
        onTimelineChange={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(useTimelineUiStore.getState().playheadMs).toBe(75_000);
  });

  it('keeps the marker editor open after adding a marker', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => TRACK_HEADER_WIDTH + 1000,
    });

    const project = projectFixture();
    const saveTimeline = vi.fn(async () => null);
    const { rerender } = renderWithProviders(
      <Timeline
        project={project}
        selectedSceneId="scene-1"
        selectedSceneSource="user"
        onTimelineChange={saveTimeline}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-marker-editor')).toBeInTheDocument();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(saveTimeline).toHaveBeenCalled();

    rerender(
      <Timeline
        project={{
          ...project,
          updatedAt: '2026-05-20T00:00:01.000Z',
        }}
        selectedSceneId="scene-1"
        selectedSceneSource="user"
        onTimelineChange={saveTimeline}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('timeline-marker-editor')).toBeInTheDocument();
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Timeline',
    template: 'explainer',
    prompt: '',
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 180_000,
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
              durationMs: 180_000,
              trimStartMs: 0,
              trimEndMs: 180_000,
              sourceDurationMs: 180_000,
            },
          ],
        },
      ],
    },
    storyboard: {
      status: 'approved',
      intent: 'Timeline',
      totalDurationMs: 180_000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 180_000,
          intent: 'Opening',
          assetPlan: { kind: 'ai-image', prompt: 'Opening' },
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

function multiSceneProjectFixture(): VideoProject {
  const project = projectFixture();
  const videoTrack = project.timeline!.tracks[0];
  if (!videoTrack || videoTrack.kind !== 'video') {
    throw new Error('Expected video track fixture');
  }
  return {
    ...project,
    timeline: {
      ...project.timeline!,
      durationMs: 180_000,
      tracks: [
        {
          ...videoTrack,
          clips: [
            clipFixture('clip-scene-1', 'scene-1', 0),
            clipFixture('clip-scene-2', 'scene-2', 60_000),
            clipFixture('clip-scene-3', 'scene-3', 120_000),
          ],
        },
      ],
    },
    storyboard: {
      ...project.storyboard!,
      totalDurationMs: 180_000,
      scenes: ['scene-1', 'scene-2', 'scene-3'].map((id, index) => ({
        id,
        durationMs: 60_000,
        intent: `Scene ${index + 1}`,
        assetPlan: { kind: 'ai-image', prompt: `Scene ${index + 1}` },
      })),
    },
  };
}

function clipFixture(id: string, sceneId: string, startMs: number) {
  return {
    id,
    kind: 'video' as const,
    name: sceneId,
    sourceRef: { kind: 'scene' as const, sceneId },
    sceneId,
    startMs,
    durationMs: 60_000,
    trimStartMs: 0,
    trimEndMs: 60_000,
    sourceDurationMs: 60_000,
  };
}
