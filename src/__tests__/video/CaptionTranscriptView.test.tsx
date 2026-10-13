import { createElement, type ReactNode } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CaptionTranscriptView,
  captionCuesFromTimeline,
  redistributeCaptionWords,
} from '@/components/video/CaptionTranscriptView';
import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import { TranscriptView } from '@/components/video/TranscriptView';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type {
  VideoCaptionTimelineClip,
  VideoProject,
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

afterEach(() => {
  useTimelineUiStore.getState().setPlayheadMs(0);
  useTimelineEditorStore.setState({
    timeline: null,
    userHistory: [],
    userHistoryIndex: 0,
  });
});

function translatedTimeline(options?: {
  duplicateIds?: boolean;
}): VideoTimeline {
  const source = cue({ id: 'source-cue', text: 'hello source' });
  const tl = timeline([source]);
  tl.tracks.push({
    id: 'c-es',
    kind: 'caption',
    name: 'Spanish captions',
    language: 'es',
    hidden: true,
    muted: false,
    locked: false,
    order: 30,
    clips: [
      cue({
        id: options?.duplicateIds ? source.id : 'spanish-cue',
        text: 'hola mundo',
        sourceRef: { kind: 'scene', sceneId: 'scene-1' },
      }),
    ],
  });
  return tl;
}

describe('captionCuesFromTimeline', () => {
  it('returns caption-track clips sorted by start time', () => {
    const tl = timeline([
      cue({ id: 'b', startMs: 2000 }),
      cue({ id: 'a', startMs: 0 }),
    ]);
    expect(captionCuesFromTimeline(tl).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('reads only the chosen track, including hidden translations', () => {
    const tl = translatedTimeline();
    expect(captionCuesFromTimeline(tl, 'c-es').map((c) => c.text)).toEqual([
      'hola mundo',
    ]);
    expect(captionCuesFromTimeline(tl, 'missing')).toEqual([]);
  });

  it('finds captions when an earlier caption track is empty', () => {
    const tl = translatedTimeline();
    const primary = tl.tracks.find((track) => track.id === 'c');
    if (primary) primary.clips = [];
    expect(captionCuesFromTimeline(tl).map((c) => c.text)).toEqual([
      'hola mundo',
    ]);
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

  it('selects a hidden language track and edits only its cue', async () => {
    const user = userEvent.setup();
    const tl = translatedTimeline();
    useTimelineEditorStore.setState({ timeline: tl });
    render(
      createElement(CaptionTranscriptView, {
        cues: captionCuesFromTimeline(tl),
      }),
      { wrapper },
    );

    expect(
      screen.getByRole('button', { name: 'hello source' }),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Caption track / language' }),
      'c-es',
    );
    expect(
      screen.queryByRole('button', { name: 'hello source' }),
    ).not.toBeInTheDocument();
    await user.dblClick(screen.getByRole('button', { name: 'hola mundo' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'hola planeta{Enter}');

    const stored = useTimelineEditorStore.getState().timeline!;
    expect(captionCuesFromTimeline(stored, 'c')[0]?.text).toBe('hello source');
    const translated = stored.tracks.find((track) => track.id === 'c-es');
    expect(captionCuesFromTimeline(stored, 'c-es')[0]?.text).toBe(
      'hola planeta',
    );
    expect(translated?.clips[0]?.sourceRef).toEqual({
      kind: 'scene',
      sceneId: 'scene-1',
    });
    expect(translated).toMatchObject({ language: 'es', hidden: true });
    expect(screen.getByRole('combobox')).toHaveValue('c-es');
    expect(
      screen.getByRole('button', { name: 'hola planeta' }),
    ).toBeInTheDocument();
  });

  it('uses persisted tracks before store hydration', async () => {
    const tl = translatedTimeline();
    render(
      createElement(CaptionTranscriptView, {
        cues: captionCuesFromTimeline(tl),
        timeline: tl,
      }),
      { wrapper },
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'c-es');
    expect(
      screen.getByRole('button', { name: 'hola mundo' }),
    ).toBeInTheDocument();
  });

  it('keeps the chosen track after another translation is added', async () => {
    const tl = translatedTimeline();
    useTimelineEditorStore.setState({ timeline: tl });
    render(
      createElement(CaptionTranscriptView, {
        cues: captionCuesFromTimeline(tl),
      }),
      { wrapper },
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'c-es');
    act(() =>
      useTimelineEditorStore.setState({
        timeline: {
          ...tl,
          tracks: [
            ...tl.tracks,
            {
              ...tl.tracks.find((track) => track.id === 'c-es')!,
              id: 'c-fr',
              name: 'French captions',
              clips: [],
            },
          ],
        },
      }),
    );
    expect(screen.getByRole('combobox')).toHaveValue('c-es');
  });

  it('cancels a draft on track switch and falls back when the track is removed', async () => {
    const user = userEvent.setup();
    const tl = translatedTimeline();
    useTimelineEditorStore.setState({ timeline: tl });
    render(
      createElement(CaptionTranscriptView, {
        cues: captionCuesFromTimeline(tl),
      }),
      { wrapper },
    );
    await user.selectOptions(screen.getByRole('combobox'), 'c-es');
    await user.dblClick(screen.getByRole('button', { name: 'hola mundo' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'unsaved');
    // A change event switches without first committing the textarea's blur.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c' } });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      captionCuesFromTimeline(
        useTimelineEditorStore.getState().timeline,
        'c-es',
      )[0]?.text,
    ).toBe('hola mundo');
    await user.selectOptions(screen.getByRole('combobox'), 'c-es');
    act(() => useTimelineEditorStore.getState().removeTrack('c-es'));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'hello source' }),
    ).toBeInTheDocument();
  });

  it('refuses edits to ambiguous legacy cue IDs', async () => {
    const user = userEvent.setup();
    const tl = translatedTimeline({ duplicateIds: true });
    useTimelineEditorStore.setState({ timeline: tl });
    render(
      createElement(CaptionTranscriptView, {
        cues: captionCuesFromTimeline(tl),
      }),
      { wrapper },
    );
    await user.selectOptions(screen.getByRole('combobox'), 'c-es');
    await user.dblClick(screen.getByRole('button', { name: 'hola mundo' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'changed{Enter}');
    expect(useTimelineEditorStore.getState().timeline).toEqual(tl);
  });

  it('cancels Escape without saving on blur and respects locked tracks', async () => {
    const user = userEvent.setup();
    const tl = timeline(cues);
    useTimelineEditorStore.setState({ timeline: tl });
    render(createElement(CaptionTranscriptView, { cues }), { wrapper });
    await user.dblClick(screen.getByRole('button', { name: 'hello' }));
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'discarded{Escape}');
    fireEvent.blur(textarea);
    expect(useTimelineEditorStore.getState().timeline).toEqual(tl);
    act(() =>
      useTimelineEditorStore.getState().updateTrack('c', { locked: true }),
    );
    await user.dblClick(screen.getByRole('button', { name: 'hello' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
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

describe('storyboard compatibility', () => {
  it('retains scene text editing when no timeline captions exist', async () => {
    const project: VideoProject = {
      id: 'storyboard-project',
      name: 'Storyboard',
      template: 'custom',
      prompt: '',
      assets: [],
      createdAt: 'now',
      updatedAt: 'now',
      timeline: timeline([]),
      storyboard: {
        status: 'draft',
        intent: 'story',
        totalDurationMs: 1000,
        costEstimateUsd: { low: 0, high: 0 },
        scenes: [
          {
            id: 'scene-1',
            durationMs: 1000,
            intent: 'Scene',
            caption: { text: 'original scene' },
            assetPlan: { kind: 'existing', assetId: 'a' },
          },
        ],
      },
    };
    const updateStoryboard = vi.fn().mockResolvedValue(project);
    // This view exercises only the storyboard action.
    const actions = {
      updateStoryboard,
    } as unknown as VideoProjectEditorActions;
    render(createElement(TranscriptView, { project, actions }), { wrapper });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const textarea = screen.getByRole('textbox', {
      name: 'Scene transcript text',
    });
    fireEvent.change(textarea, { target: { value: 'edited scene' } });
    fireEvent.blur(textarea);
    expect(updateStoryboard).toHaveBeenCalledWith(
      expect.objectContaining({
        scenes: [
          expect.objectContaining({ caption: { text: 'edited scene' } }),
        ],
      }),
    );
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
