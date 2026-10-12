import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import { SourceTranscriptPanel } from '@/components/video/transcript/SourceTranscriptPanel';
import { normalizeCorrection } from '@/components/video/transcript/TranscriptWordEditor';
import { useTranscriptSelectionStore } from '@/components/video/transcript/useTranscriptSelectionStore';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

const words = ['helo', 'world.'].map((text, i) => ({
  text,
  startMs: i * 100,
  endMs: i * 100 + 100,
}));

const project = {
  sources: [{ id: 's', mediaItemId: 'a' }],
  sourceAnalyses: [
    { id: 'an', sourceId: 's', transcript: { engine: 't', words } },
  ],
  timeline: {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 200,
    tracks: [
      {
        id: 't',
        kind: 'video',
        name: 'V',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            id: 'c',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'a' },
            startMs: 0,
            durationMs: 200,
            trimStartMs: 0,
            trimEndMs: 200,
          },
        ],
      },
    ],
  },
} as unknown as VideoProject;

describe('normalizeCorrection', () => {
  it('discards empty, multi-word, and unchanged input', () => {
    expect(normalizeCorrection('a', '  ')).toBeNull();
    expect(normalizeCorrection('a', 'two words')).toBeNull();
    expect(normalizeCorrection('a', 'a')).toBeNull();
    expect(normalizeCorrection('a', ' b ')).toBe('b');
  });
});

describe('transcript word correction', () => {
  beforeEach(() => {
    useTranscriptSelectionStore.setState({ mode: 'text', selection: null });
    useTimelineUiStore.setState({ playheadMs: 0 });
  });

  function renderPanel(onCorrectWord = vi.fn().mockResolvedValue(undefined)) {
    render(
      <LanguageProvider>
        <SourceTranscriptPanel
          project={project}
          onCorrectWord={onCorrectWord}
        />
      </LanguageProvider>,
    );
    return onCorrectWord;
  }

  it('saves a corrected word with its timing key on Enter', () => {
    const onCorrectWord = renderPanel();
    fireEvent.doubleClick(screen.getByText('helo'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCorrectWord).toHaveBeenCalledWith('s', [
      { index: 0, text: 'Hello', startMs: 0, expectedText: 'helo' },
    ]);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('cancels on Escape without saving', () => {
    const onCorrectWord = renderPanel();
    fireEvent.doubleClick(screen.getByText('helo'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCorrectWord).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('does not edit in Cut media mode', () => {
    useTranscriptSelectionStore.setState({ mode: 'cut' });
    const onCorrectWord = renderPanel();
    fireEvent.doubleClick(screen.getByText('helo'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onCorrectWord).not.toHaveBeenCalled();
  });
});
