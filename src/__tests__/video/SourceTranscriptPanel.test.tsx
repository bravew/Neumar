import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import { SourceTranscriptPanel } from '@/components/video/transcript/SourceTranscriptPanel';
import { groupWordsIntoLines } from '@/components/video/transcript/sourceTranscriptView';
import { useTranscriptSelectionStore } from '@/components/video/transcript/useTranscriptSelectionStore';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

const words = ['one', 'two.', 'three', 'four'].map((text, i) => ({
  text,
  startMs: i * 100,
  endMs: i * 100 + 100,
}));

function project(
  trims: Array<[number, number, number]>,
  transcriptWords = words,
): VideoProject {
  return {
    sources: [{ id: 's', mediaItemId: 'a' }],
    sourceAnalyses: [
      {
        id: 'an',
        sourceId: 's',
        transcript: { engine: 't', words: transcriptWords },
      },
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

describe('groupWordsIntoLines', () => {
  it('breaks at sentence ends, long pauses and the end', () => {
    const lines = groupWordsIntoLines([
      { text: 'a', startMs: 0, endMs: 100 },
      { text: 'b.', startMs: 100, endMs: 200 },
      { text: 'c', startMs: 200, endMs: 300 },
      { text: 'd', startMs: 1200, endMs: 1300 },
    ]);
    expect(lines.map((l) => [l.startIndex, l.endIndex])).toEqual([
      [0, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});

describe('SourceTranscriptPanel', () => {
  beforeEach(() => {
    useTimelineUiStore.setState({ playheadMs: 0 });
    useTranscriptSelectionStore.setState(
      useTranscriptSelectionStore.getInitialState(),
    );
  });

  it('strikes through cut words, seeks on click, and selects with shift', () => {
    render(
      <LanguageProvider>
        <SourceTranscriptPanel
          project={project([
            [0, 0, 100],
            [100, 200, 400],
          ])}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('two.').getAttribute('data-status')).toBe('cut');
    fireEvent.click(screen.getByText('three'));
    expect(useTimelineUiStore.getState().playheadMs).toBe(100);

    fireEvent.mouseDown(screen.getByText('three'));
    fireEvent.mouseDown(screen.getByText('four'), { shiftKey: true });
    expect(useTranscriptSelectionStore.getState().selection).toEqual({
      sourceId: 's',
      startIndex: 2,
      endIndex: 3,
    });
  });

  it('keeps a selection made elsewhere when the panel mounts', () => {
    useTranscriptSelectionStore.setState({
      selection: { sourceId: 's', startIndex: 1, endIndex: 2 },
    });
    render(
      <LanguageProvider>
        <SourceTranscriptPanel project={project([])} />
      </LanguageProvider>,
    );
    expect(useTranscriptSelectionStore.getState().selection).toEqual({
      sourceId: 's',
      startIndex: 1,
      endIndex: 2,
    });
  });

  it('clears the selection when the selected source transcript is replaced', () => {
    const original = project([[0, 0, 400]]);
    const view = render(
      <LanguageProvider>
        <SourceTranscriptPanel project={original} />
      </LanguageProvider>,
    );
    fireEvent.mouseDown(screen.getByText('two.'));
    fireEvent.mouseDown(screen.getByText('three'), { shiftKey: true });
    expect(useTranscriptSelectionStore.getState().selection).not.toBeNull();

    // Replacement keys on word timings, so retime as a re-transcription would.
    const replacement = words.map((word) => ({
      text: `${word.text}-new`,
      startMs: word.startMs + 10,
      endMs: word.endMs + 10,
    }));
    view.rerender(
      <LanguageProvider>
        <SourceTranscriptPanel project={project([[0, 0, 400]], replacement)} />
      </LanguageProvider>,
    );
    expect(screen.getByText('two.-new')).toBeTruthy();
    expect(useTranscriptSelectionStore.getState().selection).toBeNull();
  });

  it('keeps the selection when the transcript is unchanged', () => {
    const view = render(
      <LanguageProvider>
        <SourceTranscriptPanel project={project([[0, 0, 400]])} />
      </LanguageProvider>,
    );
    fireEvent.mouseDown(screen.getByText('two.'));
    view.rerender(
      <LanguageProvider>
        <SourceTranscriptPanel project={project([[0, 0, 200]])} />
      </LanguageProvider>,
    );
    expect(useTranscriptSelectionStore.getState().selection).toEqual({
      sourceId: 's',
      startIndex: 1,
      endIndex: 1,
    });
  });

  it('does not seek on a cut word', () => {
    render(
      <LanguageProvider>
        <SourceTranscriptPanel project={project([[0, 0, 100]])} />
      </LanguageProvider>,
    );
    useTimelineUiStore.setState({ playheadMs: 50 });
    fireEvent.click(screen.getByText('four'));
    expect(useTimelineUiStore.getState().playheadMs).toBe(50);
  });
});
