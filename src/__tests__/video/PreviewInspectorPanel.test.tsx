import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/__tests__/helpers/render-with-providers';
import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { PreviewInspectorPanel } from '@/components/video/PreviewInspectorPanel';
import { timelineTransitionSeamId } from '@/components/video/timeline/timelineTransitions';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import type {
  VideoProject,
  VideoStoryboardScene,
  VideoTimeline,
} from '@/shared/types/video';

describe('PreviewInspectorPanel', () => {
  afterEach(() => {
    useTimelineEditorStore.setState({
      projectId: null,
      timeline: null,
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      lastSelectedClipId: null,
      selectedMarkerId: null,
      selectedSeamId: null,
    });
  });

  it('shows transition settings when a timeline transition is selected', () => {
    const timeline = timelineFixture();
    const seamId = timelineTransitionSeamId('track-video', 'clip-1', 'clip-2');
    useTimelineEditorStore.setState({
      projectId: 'project-1',
      timeline,
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      lastSelectedClipId: null,
      selectedMarkerId: null,
      selectedSeamId: seamId,
    });

    renderWithProviders(
      <PreviewInspectorPanel
        project={{ ...projectFixture(), timeline }}
        aspectRatio="16:9"
        actions={unusedActions()}
        selectedScene={sceneFixture()}
        onFindContext={() => undefined}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Transition inspector' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Duration')).toHaveLength(2);
  });
});

function unusedActions(): VideoProjectEditorActions {
  return new Proxy(
    {},
    {
      get: () => async () => null,
    },
  ) as VideoProjectEditorActions;
}

function sceneFixture(): VideoStoryboardScene {
  return {
    id: 'scene-1',
    durationMs: 1000,
    intent: 'Opening scene',
    assetPlan: { kind: 'existing', assetId: 'asset-1' },
  };
}

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Preview Inspector',
    template: 'custom',
    prompt: '',
    assets: [],
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
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
