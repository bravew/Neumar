import { describe, expect, it } from 'vitest';

import {
  applyTranscriptCorrections,
  TranscriptCorrectionError,
} from '@/shared/video/analysis/transcript-corrections';
import type {
  CaptionTimelineClip,
  VideoProject,
  VideoTimeline,
} from '@/shared/video/types';

const words = [
  { text: 'helo', startMs: 0, endMs: 500 },
  { text: 'world.', startMs: 500, endMs: 1000 },
  { text: 'again', startMs: 1000, endMs: 1500 },
];

function timeline(captionWords = words): VideoTimeline {
  const caption: CaptionTimelineClip = {
    id: 'cap',
    kind: 'caption',
    startMs: 0,
    durationMs: 1500,
    trimStartMs: 0,
    trimEndMs: 1500,
    text: captionWords.map((w) => w.text).join(' '),
    words: captionWords,
  } as CaptionTimelineClip;
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 1500,
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
            sourceRef: { kind: 'asset', assetId: 'asset' },
            startMs: 0,
            durationMs: 1500,
            trimStartMs: 0,
            trimEndMs: 1500,
          },
        ],
      },
      {
        id: 'c',
        kind: 'caption',
        name: 'C',
        muted: false,
        locked: false,
        order: 1,
        clips: [caption],
      },
    ],
  } as unknown as VideoTimeline;
}

function projectWith(base: VideoProject, tl = timeline()): VideoProject {
  return {
    ...base,
    sources: [
      {
        id: 'src',
        mediaItemId: 'asset',
        origin: 'upload',
        contentHash: 'h',
        analysisStatus: 'done',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    sourceAnalyses: [
      {
        id: 'an',
        sourceId: 'src',
        transcript: {
          engine: 't',
          words,
          segments: [{ startMs: 0, endMs: 1500, text: 'helo world. again' }],
        },
      },
    ],
    timeline: tl,
  } as unknown as VideoProject;
}

const bare = { id: 'p', revision: 1 } as unknown as VideoProject;

describe('applyTranscriptCorrections', () => {
  it('corrects word text, keeps timings, and rebuilds segment text', () => {
    const { project, captionsUpdated } = applyTranscriptCorrections(
      projectWith(bare),
      'src',
      [{ index: 0, text: 'Hello', startMs: 0 }],
    );
    const transcript = project.sourceAnalyses![0]!.transcript!;
    expect(transcript.words[0]).toEqual({
      text: 'Hello',
      startMs: 0,
      endMs: 500,
    });
    expect(transcript.segments![0]!.text).toBe('Hello world. again');
    expect(captionsUpdated).toBe(1);
  });

  it('mirrors the correction into the caption cue that plays the word', () => {
    const { project } = applyTranscriptCorrections(projectWith(bare), 'src', [
      { index: 0, text: 'Hello', startMs: 0 },
    ]);
    const cue = project.timeline!.tracks[1]!.clips[0] as CaptionTimelineClip;
    expect(cue.text).toBe('Hello world. again');
    expect(cue.words![0]!.text).toBe('Hello');
    expect(cue.words![1]).toEqual(words[1]);
  });

  it('leaves a hand-edited cue text alone but still fixes its word', () => {
    const edited = timeline();
    (edited.tracks[1]!.clips[0] as CaptionTimelineClip).text = 'custom text';
    const { project } = applyTranscriptCorrections(
      projectWith(bare, edited),
      'src',
      [{ index: 0, text: 'Hello', startMs: 0 }],
    );
    const cue = project.timeline!.tracks[1]!.clips[0] as CaptionTimelineClip;
    expect(cue.text).toBe('custom text');
    expect(cue.words![0]!.text).toBe('Hello');
  });

  it('is a no-op when nothing changes', () => {
    const input = projectWith(bare);
    const result = applyTranscriptCorrections(input, 'src', [
      { index: 0, text: 'helo', startMs: 0 },
    ]);
    expect(result.project).toBe(input);
    expect(result.captionsUpdated).toBe(0);
  });

  it('rejects a word whose timing no longer matches', () => {
    expect(() =>
      applyTranscriptCorrections(projectWith(bare), 'src', [
        { index: 1, text: 'x', startMs: 123 },
      ]),
    ).toThrow(expect.objectContaining({ code: 'stale-word' }));
  });

  it('reports a missing source or transcript', () => {
    expect(() =>
      applyTranscriptCorrections(projectWith(bare), 'nope', []),
    ).toThrow(TranscriptCorrectionError);
    const noWords = projectWith(bare);
    noWords.sourceAnalyses![0]!.transcript = {
      engine: 't',
      words: [],
      segments: [],
    };
    expect(() => applyTranscriptCorrections(noWords, 'src', [])).toThrow(
      expect.objectContaining({ code: 'no-transcript' }),
    );
  });
});
