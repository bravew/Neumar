import { describe, expect, it } from 'vitest';

import {
  applyTimelineOps,
  compileTranscriptCut,
  compileTranscriptRestore,
  deriveTranscriptWordStates,
  sourceSpanToTimelineWindow,
  type AudioTimelineClip,
  type Timeline,
  type VisualTimelineClip,
  type TimelineClip,
} from '../src';

const MATCH = { assetIds: ['asset-a'] };
// Ten 100 ms words, back to back: word i spans [i*100, i*100+100].
const WORDS = Array.from({ length: 10 }, (_, i) => ({
  startMs: i * 100,
  endMs: i * 100 + 100,
}));

function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

function clip(overrides: Partial<TimelineClip> & { id: string }): TimelineClip {
  return {
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: 'asset-a' },
    startMs: 0,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    ...overrides,
  } as TimelineClip;
}

function timeline(video: TimelineClip[], audio: TimelineClip[] = []): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 1000,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: video as VisualTimelineClip[],
      },
      {
        id: 'track-audio',
        kind: 'audio-vo',
        name: 'Audio',
        muted: false,
        locked: false,
        order: 20,
        clips: audio as AudioTimelineClip[],
      },
    ],
  };
}

function clipsOf(tl: Timeline, trackId: string) {
  return tl.tracks
    .find((track) => track.id === trackId)!
    .clips.map((c) => [c.startMs, c.durationMs, c.trimStartMs, c.trimEndMs]);
}

describe('sourceSpanToTimelineWindow', () => {
  it('scales by speed and mirrors for reverse', () => {
    const fast = clip({
      id: 'f',
      startMs: 500,
      durationMs: 500,
      playback: { speed: 2, reverse: false },
    });
    expect(sourceSpanToTimelineWindow(fast, 200, 400)).toEqual({
      startMs: 600,
      endMs: 700,
    });
    const rev = clip({ id: 'r', playback: { speed: 1, reverse: true } });
    expect(sourceSpanToTimelineWindow(rev, 200, 400)).toEqual({
      startMs: 600,
      endMs: 800,
    });
    expect(sourceSpanToTimelineWindow(rev, 1200, 1300)).toBeNull();
  });
});

describe('deriveTranscriptWordStates', () => {
  it('is null when the source is not on the timeline', () => {
    expect(deriveTranscriptWordStates(timeline([]), MATCH, WORDS)).toBeNull();
  });

  it('marks kept, cut and partial words with timeline occurrences', () => {
    const tl = timeline([
      clip({
        id: 'a',
        startMs: 0,
        durationMs: 250,
        trimStartMs: 0,
        trimEndMs: 250,
      }),
      clip({
        id: 'b',
        startMs: 250,
        durationMs: 500,
        trimStartMs: 500,
        trimEndMs: 1000,
      }),
    ]);
    const states = deriveTranscriptWordStates(tl, MATCH, WORDS)!;
    expect(states.map((s) => s.status)).toEqual([
      'kept',
      'kept',
      'partial',
      'cut',
      'cut',
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
    ]);
    expect(states[5]!.occurrences).toEqual([
      { clipId: 'b', startMs: 250, endMs: 350 },
    ]);
  });

  it('reports every occurrence when a span is used twice', () => {
    const tl = timeline([
      clip({
        id: 'a',
        startMs: 0,
        durationMs: 200,
        trimStartMs: 0,
        trimEndMs: 200,
      }),
      clip({
        id: 'b',
        startMs: 200,
        durationMs: 200,
        trimStartMs: 0,
        trimEndMs: 200,
      }),
    ]);
    const states = deriveTranscriptWordStates(tl, MATCH, WORDS)!;
    expect(states[0]!.occurrences.map((o) => o.startMs)).toEqual([0, 200]);
  });
});

describe('compileTranscriptCut', () => {
  it('cuts a middle range with ripple and splits the clip', () => {
    const tl = timeline([clip({ id: 'a' })]);
    const ops = compileTranscriptCut({
      timeline: tl,
      match: MATCH,
      words: WORDS,
      startIndex: 3,
      endIndex: 5,
      idFactory: ids(),
    });
    const next = applyTimelineOps(tl, ops).timeline;
    expect(clipsOf(next, 'track-video')).toEqual([
      [0, 300, 0, 300],
      [300, 400, 600, 1000],
    ]);
    const states = deriveTranscriptWordStates(next, MATCH, WORDS)!;
    expect(states.map((s) => s.status).join()).toBe(
      'kept,kept,kept,cut,cut,cut,kept,kept,kept,kept',
    );
  });

  it('honors playback speed when computing trims', () => {
    // 1000 ms of source at 2x occupies 500 ms of timeline.
    const tl = timeline([
      clip({
        id: 'a',
        durationMs: 500,
        playback: { speed: 2, reverse: false },
      }),
    ]);
    const ops = compileTranscriptCut({
      timeline: tl,
      match: MATCH,
      words: WORDS,
      startIndex: 4,
      endIndex: 5,
      idFactory: ids(),
    });
    const next = applyTimelineOps(tl, ops).timeline;
    expect(clipsOf(next, 'track-video')).toEqual([
      [0, 200, 0, 400],
      [200, 200, 600, 1000],
    ]);
  });

  it('cuts linked audio and keeps split link groups paired', () => {
    const tl = timeline(
      [clip({ id: 'v', linkGroupId: 'g' })],
      [clip({ id: 'au', kind: 'audio', linkGroupId: 'g' })],
    );
    const ops = compileTranscriptCut({
      timeline: tl,
      match: MATCH,
      words: WORDS,
      startIndex: 2,
      endIndex: 3,
      idFactory: ids(),
    });
    const next = applyTimelineOps(tl, ops).timeline;
    expect(clipsOf(next, 'track-audio')).toEqual(clipsOf(next, 'track-video'));
    const groups = next.tracks.flatMap((t) =>
      t.clips.map((c) => c.linkGroupId),
    );
    expect(new Set(groups).size).toBe(2);
    expect(groups).not.toContain('g');
  });

  it('cuts every occurrence of a repeated span', () => {
    const tl = timeline([
      clip({
        id: 'a',
        startMs: 0,
        durationMs: 400,
        trimStartMs: 0,
        trimEndMs: 400,
      }),
      clip({
        id: 'b',
        startMs: 400,
        durationMs: 400,
        trimStartMs: 0,
        trimEndMs: 400,
      }),
    ]);
    const ops = compileTranscriptCut({
      timeline: tl,
      match: MATCH,
      words: WORDS,
      startIndex: 1,
      endIndex: 1,
      idFactory: ids(),
    });
    const next = applyTimelineOps(tl, ops).timeline;
    expect(next.tracks[0]!.clips.reduce((s, c) => s + c.durationMs, 0)).toBe(
      600,
    );
  });

  it('returns no ops when the range is not on the timeline and rejects bad ranges', () => {
    const tl = timeline([clip({ id: 'a', durationMs: 300, trimEndMs: 300 })]);
    expect(
      compileTranscriptCut({
        timeline: tl,
        match: MATCH,
        words: WORDS,
        startIndex: 6,
        endIndex: 7,
      }),
    ).toEqual([]);
    expect(() =>
      compileTranscriptCut({
        timeline: tl,
        match: MATCH,
        words: WORDS,
        startIndex: 4,
        endIndex: 2,
      }),
    ).toThrow(/Invalid transcript word range/);
  });
});

describe('compileTranscriptRestore', () => {
  it('cut then undo-by-restore returns the original clip spans (speed 1 and 2x)', () => {
    for (const speed of [1, 2]) {
      const original = timeline([
        clip({
          id: 'a',
          durationMs: 1000 / speed,
          playback: speed === 1 ? undefined : { speed, reverse: false },
        }),
      ]);
      const cutOps = compileTranscriptCut({
        timeline: original,
        match: MATCH,
        words: WORDS,
        startIndex: 6,
        endIndex: 9,
        idFactory: ids(),
      });
      const cut = applyTimelineOps(original, cutOps).timeline;
      const restored = compileTranscriptRestore({
        timeline: cut,
        match: MATCH,
        words: WORDS,
        startIndex: 6,
        endIndex: 9,
      });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const next = applyTimelineOps(cut, restored.ops).timeline;
      expect(clipsOf(next, 'track-video')).toEqual(
        clipsOf(original, 'track-video'),
      );
    }
  });

  it('restores a mid-clip cut and re-extends following clips', () => {
    const original = timeline([clip({ id: 'a' })]);
    const cut = applyTimelineOps(
      original,
      compileTranscriptCut({
        timeline: original,
        match: MATCH,
        words: WORDS,
        startIndex: 3,
        endIndex: 5,
        idFactory: ids(),
      }),
    ).timeline;
    const restored = compileTranscriptRestore({
      timeline: cut,
      match: MATCH,
      words: WORDS,
      startIndex: 3,
      endIndex: 5,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const next = applyTimelineOps(cut, restored.ops).timeline;
    const states = deriveTranscriptWordStates(next, MATCH, WORDS)!;
    expect(states.every((s) => s.status === 'kept')).toBe(true);
    expect(next.tracks[0]!.clips.reduce((s, c) => s + c.durationMs, 0)).toBe(
      1000,
    );
  });

  it('fails clearly when there is no seam or the gap is interior', () => {
    const whole = timeline([clip({ id: 'a' })]);
    expect(
      compileTranscriptRestore({
        timeline: whole,
        match: MATCH,
        words: WORDS,
        startIndex: 3,
        endIndex: 5,
      }),
    ).toEqual({ ok: false, reason: 'seam-not-found' });

    const cutBig = applyTimelineOps(
      whole,
      compileTranscriptCut({
        timeline: whole,
        match: MATCH,
        words: WORDS,
        startIndex: 2,
        endIndex: 7,
        idFactory: ids(),
      }),
    ).timeline;
    expect(
      compileTranscriptRestore({
        timeline: cutBig,
        match: MATCH,
        words: WORDS,
        startIndex: 4,
        endIndex: 5,
      }),
    ).toEqual({ ok: false, reason: 'interior-gap' });
  });
});
