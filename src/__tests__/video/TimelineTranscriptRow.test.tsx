import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import { buildSourceTranscriptViews } from '@/components/video/transcript/sourceTranscriptView';
import { TimelineTranscriptRow } from '@/components/video/transcript/TimelineTranscriptRow';
import { buildTranscriptLayer } from '@/components/video/transcript/transcriptLayerModel';
import { useTranscriptSelectionStore } from '@/components/video/transcript/useTranscriptSelectionStore';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

const words = ['one', 'two.', 'three', 'four.'].map((text, i) => ({
  text,
  startMs: i * 100,
  endMs: i * 100 + 100,
}));

/** Each tuple is [timelineStartMs, trimStartMs, trimEndMs] of one clip. */
function project(trims: Array<[number, number, number]>): VideoProject {
  return {
    sources: [{ id: 's', mediaItemId: 'a' }],
    sourceAnalyses: [
      { id: 'an', sourceId: 's', transcript: { engine: 't', words } },
    ],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 400,
      tracks: [
        {
          id: 't',
          kind: 'video',
          name: 'V',
          muted: false,
          locked: false,
          order: 0,
          clips: trims.map(([startMs, trimStartMs, trimEndMs], i) => ({
            id: `c${i}`,
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'a' },
            startMs,
            durationMs: trimEndMs - trimStartMs,
            trimStartMs,
            trimEndMs,
          })),
        },
      ],
    },
  } as unknown as VideoProject;
}

function layerOf(p: VideoProject) {
  return buildTranscriptLayer(buildSourceTranscriptViews(p)[0]!);
}

describe('buildTranscriptLayer', () => {
  it('groups kept words into sentence blocks on the timeline', () => {
    const { blocks, cuts } = layerOf(project([[0, 0, 400]]));
    expect(cuts).toEqual([]);
    expect(
      blocks.map((b) => [b.startIndex, b.endIndex, b.startMs, b.endMs]),
    ).toEqual([
      [0, 1, 0, 200],
      [2, 3, 200, 400],
    ]);
  });

  it('marks a removed run as a seam and keeps blocks apart', () => {
    // Words 1-2 (100-300 source) cut out; the tail ripples up to 100.
    const { blocks, cuts } = layerOf(
      project([
        [0, 0, 100],
        [100, 300, 400],
      ]),
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ startIndex: 1, endIndex: 2, atMs: 100 });
    expect(blocks.map((b) => [b.startIndex, b.endIndex])).toEqual([
      [0, 0],
      [3, 3],
    ]);
  });

  it('renders each repeated occurrence and never bridges disconnected clips', () => {
    const repeated = layerOf(
      project([
        [0, 0, 400],
        [2000, 0, 400],
      ]),
    );
    expect(repeated.blocks.map((b) => b.startMs)).toEqual([0, 200, 2000, 2200]);
    const disconnected = layerOf(
      project([
        [0, 0, 100],
        [9000, 100, 400],
      ]),
    );
    expect(disconnected.blocks[0]).toMatchObject({
      startMs: 0,
      endMs: 100,
      startIndex: 0,
      endIndex: 0,
    });
    expect(disconnected.blocks[1]!.startMs).toBe(9000);
    expect(new Set(repeated.blocks.map((b) => b.key)).size).toBe(4);
  });

  it('is empty when no clip plays the source', () => {
    expect(layerOf(project([]))).toEqual({ blocks: [], cuts: [] });
  });
});

describe('TimelineTranscriptRow', () => {
  beforeEach(() => {
    useTranscriptSelectionStore.getState().clearSelection();
    useTimelineUiStore.setState({ pixelsPerSecond: 100, scrollX: 0 });
  });

  function renderRow(p: VideoProject, onSeek = vi.fn()) {
    render(
      <LanguageProvider>
        <TimelineTranscriptRow
          project={p}
          timeline={p.timeline ?? null}
          onSeek={onSeek}
        />
      </LanguageProvider>,
    );
    return onSeek;
  }

  it('renders nothing without a transcript on the timeline', () => {
    renderRow(project([]));
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('selects a block range and seeks to it', () => {
    const onSeek = renderRow(project([[0, 0, 400]]));
    fireEvent.click(screen.getByTitle('three four.'));
    expect(onSeek).toHaveBeenCalledWith(200);
    expect(useTranscriptSelectionStore.getState().selection).toEqual({
      sourceId: 's',
      startIndex: 2,
      endIndex: 3,
    });
  });

  it('selects the cut words when a seam marker is clicked', () => {
    const onSeek = renderRow(
      project([
        [0, 0, 100],
        [100, 300, 400],
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: /cut/i }));
    expect(onSeek).toHaveBeenCalledWith(100);
    expect(useTranscriptSelectionStore.getState().selection).toEqual({
      sourceId: 's',
      startIndex: 1,
      endIndex: 2,
    });
  });
});
