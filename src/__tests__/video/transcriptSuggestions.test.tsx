import { fireEvent, render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import { buildSourceTranscriptViews } from '@/components/video/transcript/sourceTranscriptView';
import {
  compileSuggestionCut,
  suggestionWindows,
} from '@/components/video/transcript/transcriptSuggestionPlan';
import { TranscriptSuggestions } from '@/components/video/transcript/TranscriptSuggestions';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoCutCandidate, VideoProject } from '@/shared/types/video';

const candidate: VideoCutCandidate = {
  id: 'gap',
  sourceId: 's',
  startMs: 500,
  endMs: 1500,
  reason: 'silence',
  confidence: 0.9,
  recommendation: 'cut',
};
const project = {
  id: 'suggestions',
  sources: [{ id: 's', mediaItemId: 'a' }],
  sourceAnalyses: [
    {
      id: 'an',
      sourceId: 's',
      transcript: {
        engine: 't',
        words: [
          { text: 'hi', startMs: 0, endMs: 500 },
          { text: 'there', startMs: 1500, endMs: 2000 },
        ],
      },
    },
  ],
  timeline: {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 2000,
    tracks: [
      {
        id: 'v',
        kind: 'video',
        name: 'V',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            id: 'clip',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'a' },
            startMs: 0,
            durationMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
          },
        ],
      },
    ],
  },
} as unknown as VideoProject;
const view = buildSourceTranscriptViews(project)[0]!;

beforeEach(() => {
  useTimelineEditorStore.setState({
    ...useTimelineEditorStore.getInitialState(),
    projectId: project.id,
    timeline: project.timeline!,
  });
  useTimelineUiStore.setState({ playheadMs: 0, playbackState: 'paused' });
});

function renderSuggestions() {
  return render(
    <LanguageProvider>
      <TranscriptSuggestions view={view} candidates={[candidate]} />
    </LanguageProvider>,
  );
}

describe('transcript suggestions', () => {
  it('cuts the actual silence gap without removing either adjacent word', () => {
    const ops = compileSuggestionCut(project.timeline!, view, candidate);
    expect(ops[0]).toMatchObject({
      kind: 'clip.removeTimeRange',
      startMs: 500,
      endMs: 1500,
    });
    expect(
      suggestionWindows(project.timeline!, view, {
        ...candidate,
        sourceId: 'other',
      }),
    ).toEqual([]);
  });
  it('loops preview and stops playback on cleanup', () => {
    const { unmount } = renderSuggestions();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(useTimelineUiStore.getState().playheadMs).toBe(500);
    expect(useTimelineUiStore.getState().playbackState).toBe('playing');
    act(() =>
      useTimelineUiStore.getState().setPlayheadMs(1500, { source: 'preview' }),
    );
    expect(useTimelineUiStore.getState().playheadMs).toBe(500);
    unmount();
    expect(useTimelineUiStore.getState().playbackState).toBe('paused');
  });
  it('dismisses without changing media', () => {
    renderSuggestions();
    const before = useTimelineEditorStore.getState().timeline;
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(useTimelineEditorStore.getState().timeline).toBe(before);
  });
  it('accepts as one undo step and hides the consumed suggestion', () => {
    renderSuggestions();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    const store = useTimelineEditorStore.getState();
    expect(store.timeline!.durationMs).toBe(1000);
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    act(() => store.undoUserEdit());
    expect(useTimelineEditorStore.getState().timeline!.durationMs).toBe(2000);
  });
});
