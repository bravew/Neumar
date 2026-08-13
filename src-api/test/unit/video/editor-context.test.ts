import { describe, expect, it } from 'vitest';

import { buildCurrentVideoContext } from '@/shared/video/editor-context';
import type { VideoProject } from '@/shared/video/types';

function projectWithSelectedOverlay(): VideoProject {
  return {
    id: 'project-ctx-1',
    name: 'Context fixture',
    template: 'product-reel',
    prompt: 'context test',
    assets: [],
    render: { status: 'idle', updatedAt: '2026-07-07T00:00:00.000Z' },
    outputs: [],
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 5000,
      fps: 30,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video 1',
          muted: false,
          locked: false,
          order: 0,
          clips: [
            {
              id: 'clip-video-1',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-a' },
              startMs: 0,
              durationMs: 5000,
              trimStartMs: 0,
              trimEndMs: 5000,
            },
          ],
        },
        {
          id: 'track-overlay-1',
          kind: 'overlay',
          name: 'Overlay 1',
          muted: false,
          locked: false,
          order: 1,
          clips: [
            {
              id: 'clip-overlay-1',
              kind: 'effect',
              effectType: 'vivid-overlay',
              sourceRef: {
                kind: 'asset',
                assetId: 'vivid-overlay-preset:html.marker-highlight',
              },
              startMs: 400,
              durationMs: 2500,
              trimStartMs: 0,
              trimEndMs: 2500,
              params: {
                presetId: 'html.marker-highlight',
                backend: 'html',
                controls: { text: 'Highlight this', color: '#ffd166' },
                loop: 'hold',
              },
            },
          ],
        },
      ],
    },
  };
}

describe('buildCurrentVideoContext overlay summary', () => {
  it('surfaces the selected overlay clip editable controls with schema and values', () => {
    const context = buildCurrentVideoContext(projectWithSelectedOverlay(), {
      editorSelection: {
        playheadMs: 1000,
        selectedClipIds: ['clip-overlay-1'],
      },
      include: ['selection'],
    });

    const selected = (
      context as {
        selection: { selectedClips: Array<{ clip: Record<string, unknown> }> };
      }
    ).selection.selectedClips;
    expect(selected).toHaveLength(1);
    expect(selected[0]!.clip.overlay).toEqual({
      presetId: 'html.marker-highlight',
      backend: 'html',
      loop: 'hold',
      editTool: 'video_set_overlay_controls',
      controls: [
        {
          id: 'text',
          type: 'text',
          value: 'Highlight this',
          min: undefined,
          max: undefined,
          step: undefined,
          options: undefined,
        },
        {
          id: 'color',
          type: 'color',
          value: '#ffd166',
          min: undefined,
          max: undefined,
          step: undefined,
          options: undefined,
        },
        {
          id: 'fontSize',
          type: 'number',
          value: 64,
          keyframeTool: 'video_set_overlay_control_keyframes',
          min: 24,
          max: 160,
          step: 4,
          options: undefined,
        },
      ],
    });
  });

  it('omits the overlay field for non-overlay clips and invalid params', () => {
    const project = projectWithSelectedOverlay();
    const context = buildCurrentVideoContext(project, {
      editorSelection: { selectedClipIds: ['clip-video-1'] },
      include: ['selection'],
    });
    const selected = (
      context as {
        selection: { selectedClips: Array<{ clip: Record<string, unknown> }> };
      }
    ).selection.selectedClips;
    expect(selected[0]!.clip.overlay).toBeUndefined();
  });
});
