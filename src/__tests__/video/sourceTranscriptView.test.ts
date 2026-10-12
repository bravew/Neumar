import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildSourceTranscriptViews,
  cutRunAround,
  findActiveWordIndex,
  wordSeekMs,
} from '@/components/video/transcript/sourceTranscriptView';
import { useTranscriptSelectionStore } from '@/components/video/transcript/useTranscriptSelectionStore';
import type { VideoProject } from '@/shared/types/video';

const words = Array.from({ length: 6 }, (_, i) => ({
  text: `w${i}`,
  startMs: i * 100,
  endMs: i * 100 + 100,
}));

function project(clips: Array<[number, number, number]>): VideoProject {
  return {
    sources: [{ id: 'src-1', mediaItemId: 'asset-1' }],
    sourceAnalyses: [
      {
        id: 'an-1',
        sourceId: 'src-1',
        transcript: { engine: 'test', words },
      },
    ],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 600,
      tracks: [
        {
          id: 't',
          kind: 'video',
          name: 'V',
          muted: false,
          locked: false,
          order: 0,
          clips: clips.map(([startMs, trimStartMs, trimEndMs], i) => ({
            id: `c${i}`,
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-1' },
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

describe('buildSourceTranscriptViews', () => {
  it('derives word states and active word from the timeline', () => {
    const [view] = buildSourceTranscriptViews(
      project([
        [0, 0, 200],
        [200, 400, 600],
      ]),
    );
    expect(view!.states!.map((s) => s.status)).toEqual([
      'kept',
      'kept',
      'cut',
      'cut',
      'kept',
      'kept',
    ]);
    expect(findActiveWordIndex(view!, 250)).toBe(4);
    expect(findActiveWordIndex(view!, 150)).toBe(1);
  });

  it('has null states when the source is not on the timeline, and skips sources without words', () => {
    const empty = project([]);
    expect(buildSourceTranscriptViews(empty)[0]!.states).toBeNull();
    const noWords = project([[0, 0, 200]]);
    noWords.sourceAnalyses![0]!.transcript = undefined;
    expect(buildSourceTranscriptViews(noWords)).toEqual([]);
  });

  it('seeks to the first occurrence at or after the playhead', () => {
    const [view] = buildSourceTranscriptViews(
      project([
        [0, 0, 200],
        [200, 0, 200],
      ]),
    );
    const state = view!.states![0];
    expect(wordSeekMs(state, 0)).toBe(0);
    expect(wordSeekMs(state, 50)).toBe(200);
    expect(wordSeekMs(view!.states![3], 0)).toBeNull();
  });

  it('finds the contiguous cut run around a word', () => {
    const [view] = buildSourceTranscriptViews(
      project([
        [0, 0, 100],
        [100, 400, 600],
      ]),
    );
    expect(cutRunAround(view!.states!, 3)).toEqual({
      startIndex: 1,
      endIndex: 3,
    });
    expect(cutRunAround(view!.states!, 0)).toBeNull();
  });

  it('changes the transcript key when the transcript is replaced', () => {
    const a = buildSourceTranscriptViews(project([[0, 0, 600]]))[0]!;
    const p = project([[0, 0, 600]]);
    p.sourceAnalyses![0]!.transcript!.words = words.slice(0, 5);
    expect(buildSourceTranscriptViews(p)[0]!.transcriptKey).not.toBe(
      a.transcriptKey,
    );
  });
});

describe('useTranscriptSelectionStore', () => {
  beforeEach(() => {
    useTranscriptSelectionStore.setState(
      useTranscriptSelectionStore.getInitialState(),
    );
  });

  it('defaults to the safe text mode and extends from the anchor', () => {
    const store = useTranscriptSelectionStore.getState();
    expect(store.mode).toBe('text');
    store.selectWord('s', 4);
    useTranscriptSelectionStore.getState().selectWord('s', 2, true);
    expect(useTranscriptSelectionStore.getState().selection).toEqual({
      sourceId: 's',
      startIndex: 2,
      endIndex: 4,
    });
    useTranscriptSelectionStore.getState().clearSelection();
    expect(useTranscriptSelectionStore.getState().selection).toBeNull();
  });
});
