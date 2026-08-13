import { createElement, type ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CaptionTranscriptView,
  captionCuesFromTimeline,
  redistributeCaptionWords,
} from '@/components/video/CaptionTranscriptView';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type {
  VideoCaptionTimelineClip,
  VideoTimeline,
} from '@/shared/types/video';

function cue(
  over: Partial<VideoCaptionTimelineClip>,
): VideoCaptionTimelineClip {
  return {
    id: 'cue',
    kind: 'caption',
    sourceRef: { kind: 'asset', assetId: 'a' },
    startMs: 0,
    durationMs: 500,
    trimStartMs: 0,
    trimEndMs: 500,
    text: 'hello world',
    ...over,
  };
}

function timeline(clips: VideoCaptionTimelineClip[]): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 5000,
    tracks: [
      {
        id: 'v',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: [],
      },
      {
        id: 'c',
        kind: 'caption',
        name: 'Captions',
        muted: false,
        locked: false,
        order: 30,
        clips,
      },
    ],
  };
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(LanguageProvider, null, children);

afterEach(() => useTimelineUiStore.getState().setPlayheadMs(0));

describe('captionCuesFromTimeline', () => {
  it('returns caption-track clips sorted by start time', () => {
    const tl = timeline([
      cue({ id: 'b', startMs: 2000 }),
      cue({ id: 'a', startMs: 0 }),
    ]);
    expect(captionCuesFromTimeline(tl).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('returns [] when there is no caption track or timeline', () => {
    expect(captionCuesFromTimeline(null)).toEqual([]);
    expect(
      captionCuesFromTimeline({
        schema: 'neuma.video.timeline.v1',
        fps: 30,
        durationMs: 0,
        tracks: [],
      }),
    ).toEqual([]);
  });
});

describe('CaptionTranscriptView', () => {
  const cues = [
    cue({
      id: 'c1',
      startMs: 1000,
      durationMs: 500,
      text: 'hello world',
      words: [
        { text: 'hello', startMs: 1000, endMs: 1250 },
        { text: 'world', startMs: 1250, endMs: 1500 },
      ],
    }),
  ];

  it('seeks the playhead to a word when clicked', async () => {
    render(createElement(CaptionTranscriptView, { cues }), { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'world' }));
    expect(useTimelineUiStore.getState().playheadMs).toBe(1250);
  });

  it('highlights the word under the playhead', () => {
    useTimelineUiStore.getState().setPlayheadMs(1300); // inside "world"
    render(createElement(CaptionTranscriptView, { cues }), { wrapper });
    expect(screen.getByRole('button', { name: 'world' }).className).toMatch(
      /font-medium/,
    );
    expect(screen.getByRole('button', { name: 'hello' }).className).not.toMatch(
      /font-medium/,
    );
  });

  it('edits a cue inline and writes the new text back to the clip', async () => {
    const user = userEvent.setup();
    useTimelineEditorStore.setState({ timeline: timeline(cues) });
    render(createElement(CaptionTranscriptView, { cues }), { wrapper });

    await user.dblClick(screen.getByRole('button', { name: 'hello' }));
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'goodbye planet');
    await user.keyboard('{Enter}');

    const stored = useTimelineEditorStore.getState().timeline;
    const clip = stored?.tracks.find((t) => t.kind === 'caption')?.clips[0];
    expect(clip?.text).toBe('goodbye planet');
    // Word timings were redistributed across the cue span.
    expect(clip?.words?.map((w) => w.text)).toEqual(['goodbye', 'planet']);
  });
});

describe('redistributeCaptionWords', () => {
  it('spreads the cue span across new words by length', () => {
    const words = redistributeCaptionWords(
      {
        startMs: 1000,
        durationMs: 900,
        words: [{ text: 'x', startMs: 0, endMs: 1 }],
      },
      'a bb ccc',
    );
    expect(words).toEqual([
      { text: 'a', startMs: 1000, endMs: 1150 },
      { text: 'bb', startMs: 1150, endMs: 1450 },
      { text: 'ccc', startMs: 1450, endMs: 1900 },
    ]);
  });

  it('returns undefined when the cue had no word timings', () => {
    expect(
      redistributeCaptionWords({ startMs: 0, durationMs: 100 }, 'a b'),
    ).toBeUndefined();
  });
});
