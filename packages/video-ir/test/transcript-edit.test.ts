import { describe, expect, it } from 'vitest';

import {
  applyTimelineOps,
  TimelineOpSchema,
  TimelineSchema,
  CaptionTimelineClipSchema,
  compileTranscriptCut,
  compileTranscriptRestore,
  deriveTranscriptWordStates,
  sourceSpanToTimelineWindow,
  type CaptionTimelineClip,
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

function linkedSpeech(speed = 1, reverse = false): Timeline {
  const words = WORDS.map((word, index) => ({
    text: `w${index}`,
    startMs: reverse ? (1000 - word.endMs) / speed : word.startMs / speed,
    endMs: reverse ? (1000 - word.startMs) / speed : word.endMs / speed,
  })).sort((a, b) => a.startMs - b.startMs);
  const primary = {
    durationMs: 1000 / speed,
    playback: { speed, reverse },
    linkGroupId: 'speech',
  };
  const tl = timeline(
    [clip({ id: 'v', ...primary })],
    [clip({ id: 'au', kind: 'audio', ...primary })],
  );
  const cue: CaptionTimelineClip = {
    id: 'cue',
    kind: 'caption',
    sourceRef: { kind: 'asset', assetId: 'asset-a' },
    startMs: 0,
    durationMs: 1000 / speed,
    trimStartMs: 0,
    trimEndMs: 1000,
    linkGroupId: 'speech',
    text: words.map((word) => word.text).join(' '),
    words,
    tokens: words.map((word, index) => ({ ...word, id: `token-${index}` })),
  };
  tl.tracks.push({
    id: 'captions',
    kind: 'caption',
    name: 'Captions',
    locked: false,
    muted: false,
    order: 30,
    clips: [cue],
  });
  return tl;
}

/**
 * Generated STT cue for a source clip starting at 0 and playing source time
 * [0, 1000) at `speed`, mirroring `buildClipCues` in the API: words and the cue
 * span are projected from source time onto the host clip's timeline window.
 */
function generatedCue(id: string, speed: number) {
  const toTimeline = (sourceMs: number) => Math.round(sourceMs / speed);
  const words = WORDS.map((word) => ({
    text: `w${word.startMs / 100}`,
    startMs: toTimeline(word.startMs),
    endMs: toTimeline(word.endMs),
  }));
  return {
    id: 'stt',
    kind: 'caption',
    name: 'STT',
    order: 30,
    locked: false,
    muted: false,
    clips: [
      {
        id,
        kind: 'caption',
        sourceRef: { kind: 'asset', assetId: 'asset-a' },
        startMs: 0,
        durationMs: toTimeline(1000),
        trimStartMs: 0,
        trimEndMs: 1000,
        text: words.map((word) => word.text).join(' '),
        words,
        params: { sourceId: 'source-a', origin: 'stt' },
        sourceAnchor: {
          sourceMediaId: 'asset-a',
          sourceElementId: 'source-a',
          sourceStartMs: 0,
          sourceEndMs: 1000,
        },
      },
    ],
  } as unknown as Timeline['tracks'][number];
}

const TEXT_WORDS = WORDS.map((word, index) => ({ ...word, text: `w${index}` }));

function cutMiddle(original: Timeline) {
  return applyTimelineOps(
    original,
    compileTranscriptCut({
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 5,
      idFactory: ids(),
    }),
  ).timeline;
}

function restoreMiddle(cut: Timeline) {
  return compileTranscriptRestore({
    timeline: cut,
    match: MATCH,
    words: TEXT_WORDS,
    startIndex: 3,
    endIndex: 5,
  });
}

describe('transcript synchronization regressions', () => {
  it('round-trips generated caption snapshots through operation validation and inverses', () => {
    const original = linkedSpeech();
    const ops = compileTranscriptCut({
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 5,
      idFactory: ids(),
    });
    const parsed = ops.map((op) =>
      TimelineOpSchema.parse(JSON.parse(JSON.stringify(op))),
    );
    expect(parsed).toEqual(ops);
    const applied = applyTimelineOps(original, parsed);
    expect(TimelineSchema.parse(applied.timeline)).toEqual(applied.timeline);
    const inverses = applied.inverses.map((op) => TimelineOpSchema.parse(op));
    expect(applyTimelineOps(applied.timeline, inverses).timeline).toEqual(
      original,
    );
    expect(applyTimelineOps(original, parsed).timeline).toEqual(
      applied.timeline,
    );
  });

  it('rejects unknown caption fields, including nested word and anchor fields', () => {
    const track = generatedCue('over', 1);
    if (track.kind !== 'caption') throw new Error('Missing caption track');
    const cue = track.clips[0]!;
    expect(CaptionTimelineClipSchema.parse(cue)).toEqual(cue);
    for (const invalid of [
      { ...cue, unknown: true },
      { ...cue, words: [{ ...cue.words![0]!, unknown: true }] },
      { ...cue, sourceAnchor: { ...cue.sourceAnchor!, unknown: true } },
    ]) {
      expect(CaptionTimelineClipSchema.safeParse(invalid).success).toBe(false);
      expect(
        TimelineOpSchema.safeParse({
          kind: 'clip.insert',
          trackId: track.id,
          clip: invalid,
          at: cue.startMs,
        }).success,
      ).toBe(false);
    }
  });

  it.each([1, 2])(
    'cuts caption tokens and restores linked speech once at %sx',
    (speed) => {
      const original = linkedSpeech(speed);
      const cut = cutMiddle(original);
      const cueTrack = cut.tracks.find((track) => track.kind === 'caption')!;
      expect(cueTrack.clips.map((cue) => cue.text)).toEqual([
        'w0 w1 w2',
        'w6 w7 w8 w9',
      ]);
      expect(cueTrack.clips[1]!.words![0]).toEqual({
        text: 'w6',
        startMs: 300 / speed,
        endMs: 400 / speed,
      });
      expect(cueTrack.clips[1]!.tokens![0]!.startMs).toBe(300 / speed);
      const restore = restoreMiddle(cut);
      expect(restore.ok).toBe(true);
      if (!restore.ok) return;
      const applied = applyTimelineOps(cut, restore.ops);
      for (const track of applied.timeline.tracks) {
        expect(
          track.clips.map((clip) => [clip.startMs, clip.durationMs]),
        ).toEqual([
          [0, 600 / speed],
          [600 / speed, 400 / speed],
        ]);
      }
      const restoredCue = applied.timeline.tracks.find(
        (track) => track.kind === 'caption',
      )!.clips[0]!;
      expect(restoredCue.text).toBe('w0 w1 w2 w3 w4 w5');
      expect(restoredCue.words!.map((word) => word.startMs)).toEqual(
        [0, 100, 200, 300, 400, 500].map((ms) => ms / speed),
      );
      expect(
        applyTimelineOps(applied.timeline, applied.inverses).timeline,
      ).toEqual(cut);
    },
  );

  it('shifts downstream caption word timings with ripple', () => {
    const original = linkedSpeech();
    const captions = original.tracks.find((track) => track.kind === 'caption');
    if (!captions || captions.kind !== 'caption')
      throw new Error('Missing captions');
    captions.clips.push({
      ...captions.clips[0]!,
      id: 'later',
      linkGroupId: undefined,
      startMs: 1000,
      durationMs: 100,
      trimStartMs: 0,
      trimEndMs: 100,
      text: 'later',
      words: [{ text: 'later', startMs: 1000, endMs: 1100 }],
      tokens: undefined,
    });
    const cut = cutMiddle(original);
    const cutCue = cut.tracks
      .find((track) => track.kind === 'caption')!
      .clips.find((cue) => cue.id === 'later')!;
    expect(cutCue.startMs).toBe(700);
    expect(cutCue.words![0]!.startMs).toBe(700);
    const restored = restoreMiddle(cut);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const cue = applyTimelineOps(cut, restored.ops)
      .timeline.tracks.find((track) => track.kind === 'caption')!
      .clips.find((cue) => cue.id === 'later')!;
    expect(cue.startMs).toBe(1000);
    expect(cue.words![0]!.startMs).toBe(1000);
  });

  it.each([false, true])(
    'restores leading and trailing cuts with reverse=%s',
    (reverse) => {
      for (const [startIndex, endIndex] of [
        [0, 2],
        [7, 9],
      ]) {
        const original = linkedSpeech(2, reverse);
        const input = {
          timeline: original,
          match: MATCH,
          words: TEXT_WORDS,
          startIndex: startIndex!,
          endIndex: endIndex!,
        };
        const cut = applyTimelineOps(
          original,
          compileTranscriptCut({ ...input, idFactory: ids() }),
        ).timeline;
        const restored = compileTranscriptRestore({ ...input, timeline: cut });
        expect(restored.ok).toBe(true);
        if (!restored.ok) continue;
        const next = applyTimelineOps(cut, restored.ops).timeline;
        for (const track of next.tracks)
          expect(
            track.clips.map((clip) => [
              clip.startMs,
              clip.durationMs,
              clip.trimStartMs,
              clip.trimEndMs,
            ]),
          ).toEqual([[0, 500, 0, 1000]]);
      }
    },
  );

  it('restores a non-ripple cut only while its original gap remains', () => {
    const original = linkedSpeech();
    const input = {
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 5,
      magnetic: false,
    };
    const cut = applyTimelineOps(
      original,
      compileTranscriptCut({ ...input, idFactory: ids() }),
    ).timeline;
    const restored = compileTranscriptRestore({ ...input, timeline: cut });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const next = applyTimelineOps(cut, restored.ops).timeline;
    for (const track of next.tracks)
      expect(
        track.clips.map((clip) => [clip.startMs, clip.durationMs]),
      ).toEqual([
        [0, 600],
        [600, 400],
      ]);
    cut.tracks[0]!.clips[1]!.startMs += 100;
    expect(compileTranscriptRestore({ ...input, timeline: cut })).toEqual({
      ok: false,
      reason: 'seam-not-found',
    });
  });

  it.each([1, 2])(
    'keeps generated STT captions synchronized at %sx',
    (speed) => {
      const original = timeline([
        clip({
          id: 'v',
          durationMs: 1000 / speed,
          playback: { speed, reverse: false },
        }),
      ]);
      original.tracks.push(generatedCue('over', speed));
      const input = {
        timeline: original,
        match: MATCH,
        words: TEXT_WORDS,
        startIndex: 2,
        endIndex: 3,
      };
      const cut = applyTimelineOps(
        original,
        compileTranscriptCut({ ...input, idFactory: ids() }),
      ).timeline;
      const cues = cut.tracks.find((track) => track.kind === 'caption')!.clips;
      expect(cues.map((cue) => cue.text)).toEqual([
        'w0 w1',
        'w4 w5 w6 w7 w8 w9',
      ]);
      // The surviving cue starts where the removed span ended, on the timeline.
      expect(cues[1]!.words![0]!.startMs).toBe(200 / speed);
      const restored = compileTranscriptRestore({ ...input, timeline: cut });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const cue = applyTimelineOps(cut, restored.ops).timeline.tracks.find(
        (track) => track.kind === 'caption',
      )!.clips[0]!;
      expect(cue.text).toBe('w0 w1 w2 w3');
      expect(cue.words!.map((word) => word.startMs)).toEqual(
        [0, 100, 200, 300].map((startMs) => startMs / speed),
      );
    },
  );

  it('fails safely instead of leaving generated captions behind', () => {
    const original = timeline([clip({ id: 'v' })]);
    original.tracks.push(generatedCue('main', 1));
    const input = {
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 5,
    };
    const cut = applyTimelineOps(
      original,
      compileTranscriptCut({ ...input, idFactory: ids() }),
    ).timeline;
    // Drop both fragments of the cue covering the removed span, leaving nothing
    // that maps to this seam, so the editor must not report a safe restore.
    const captionTrack = cut.tracks.find((track) => track.kind === 'caption');
    if (captionTrack?.kind !== 'caption') throw new Error('Missing captions');
    captionTrack.clips = [];
    expect(compileTranscriptRestore({ ...input, timeline: cut })).toEqual({
      ok: false,
      reason: 'caption-unavailable',
    });
  });

  it('restores a generated cue that starts at the first cut word', () => {
    // A cue whose first word is cut survives on the far side of the seam: its
    // start edge, not its end edge, meets the restore. It must be extended from
    // the start instead of failing as `caption-unavailable`.
    const original = timeline([clip({ id: 'v' })]);
    const cue = generatedCue('tail', 1);
    const track = cue as unknown as { clips: Array<Record<string, unknown>> };
    const full = track.clips[0]!;
    const words = (
      full.words as Array<{ text: string; startMs: number }>
    ).slice(3);
    track.clips[0] = {
      ...full,
      startMs: 300,
      durationMs: 700,
      trimStartMs: 300,
      text: words.map((word) => word.text).join(' '),
      words,
      sourceAnchor: {
        ...(full.sourceAnchor as object),
        sourceStartMs: 300,
      },
    };
    original.tracks.push(cue);
    const input = {
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 4,
    };
    const cut = applyTimelineOps(
      original,
      compileTranscriptCut({ ...input, idFactory: ids() }),
    ).timeline;
    expect(
      cut.tracks.find((item) => item.kind === 'caption')!.clips[0],
    ).toMatchObject({ trimStartMs: 500, startMs: 300 });

    const restored = compileTranscriptRestore({ ...input, timeline: cut });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const after = applyTimelineOps(cut, restored.ops).timeline;
    const restoredCue = after.tracks.find(
      (item) => item.kind === 'caption',
    )!.clips;
    expect(restoredCue).toHaveLength(1);
    expect(restoredCue[0]).toMatchObject({
      startMs: 300,
      durationMs: 700,
      trimStartMs: 300,
      trimEndMs: 1000,
      text: 'w3 w4 w5 w6 w7 w8 w9',
    });
    const spans = after.tracks
      .find((item) => item.kind === 'video')!
      .clips.map((item) => [item.startMs, item.durationMs]);
    expect(spans).toEqual([
      [0, 500],
      [500, 500],
    ]);
  });

  it('restores when only the linked tracks carry the link group', () => {
    // A video clip need not itself join the link group for the cut to ripple
    // across its audio/caption siblings. The restore previously re-derived the
    // seam per track from `primaries`, so once the first track's op had been
    // applied the caption fragment no longer sat at that seam's timeline edge
    // and the restore failed with `caption-unavailable`.
    const group = 'speech';
    const primary = { linkGroupId: group };
    const original = timeline(
      [clip({ id: 'v' })],
      [clip({ id: 'au', kind: 'audio', ...primary })],
    );
    original.tracks.push({
      id: 'captions',
      kind: 'caption',
      name: 'Captions',
      locked: false,
      muted: false,
      order: 30,
      clips: [
        {
          id: 'cue',
          kind: 'caption',
          sourceRef: { kind: 'asset', assetId: 'asset-a' },
          linkGroupId: group,
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
          text: TEXT_WORDS.map((word) => word.text).join(' '),
          words: TEXT_WORDS,
        },
      ],
    } as unknown as Timeline['tracks'][number]);

    const input = {
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 5,
    };
    const cut = applyTimelineOps(
      original,
      compileTranscriptCut({ ...input, idFactory: ids() }),
    ).timeline;
    const restored = compileTranscriptRestore({ ...input, timeline: cut });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const applied = applyTimelineOps(cut, restored.ops).timeline;
    // The media and its caption both return to the pre-cut source span: the
    // seam fragment is extended back over the removed range, so the pair tiles
    // the original clip again.
    const videoTrack = applied.tracks.find((track) => track.kind === 'video')!;
    expect(
      videoTrack.clips.map((clip) => [clip.startMs, clip.durationMs]),
    ).toEqual([
      [0, 600],
      [600, 400],
    ]);
    const cues = applied.tracks.find(
      (track) => track.kind === 'caption',
    )!.clips;
    expect(cues.map((cue) => [cue.startMs, cue.durationMs])).toEqual([
      [0, 600],
      [600, 400],
    ]);
    expect(cues[0]!.trimEndMs).toBe(600);
    expect(cues[0]!.text).toBe('w0 w1 w2 w3 w4 w5');
  });

  it('keeps authored caption text when the media is restored', () => {
    // Capture/manual cues carry their own text and no word timing, so the cut
    // splits them and the restore rejoins the seam fragment without rewriting
    // the text from transcript words.
    const original = timeline([clip({ id: 'v' })]);
    original.tracks.push({
      id: 'captions',
      kind: 'caption',
      name: 'Captions',
      locked: false,
      muted: false,
      order: 30,
      clips: [
        {
          id: 'authored',
          kind: 'caption',
          sourceRef: { kind: 'asset', assetId: 'asset-a' },
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
          text: 'look at this button',
          style: { fontSize: 48 },
        },
      ],
    } as unknown as Timeline['tracks'][number]);
    const input = {
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 5,
    };
    const cut = applyTimelineOps(
      original,
      compileTranscriptCut({ ...input, idFactory: ids() }),
    ).timeline;
    expect(
      cut.tracks.find((track) => track.kind === 'caption')!.clips,
    ).toHaveLength(2);
    const restored = compileTranscriptRestore({ ...input, timeline: cut });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const cues = applyTimelineOps(cut, restored.ops).timeline.tracks.find(
      (track) => track.kind === 'caption',
    )!.clips;
    // The restored span rejoins the cue on the seam without rewriting its text,
    // and the cue fragments stay aligned with the media's own split.
    expect(cues.map((cue) => [cue.text, cue.startMs, cue.durationMs])).toEqual([
      ['look at this button', 0, 600],
      ['look at this button', 600, 400],
    ]);
    expect(cues.map((cue) => [cue.trimStartMs, cue.trimEndMs])).toEqual([
      [0, 600],
      [600, 1000],
    ]);
  });

  it('tiles linked captions against the media after cut and restore', () => {
    // The core requirement: whatever the transcript cut removes, the caption
    // track must still tile the restored media without gaps or overlaps.
    const original = linkedSpeech();
    const input = {
      timeline: original,
      match: MATCH,
      words: TEXT_WORDS,
      startIndex: 3,
      endIndex: 5,
    };
    const cut = applyTimelineOps(
      original,
      compileTranscriptCut({ ...input, idFactory: ids() }),
    ).timeline;
    const captionsOf = (tl: Timeline) =>
      [...tl.tracks.find((track) => track.kind === 'caption')!.clips].sort(
        (l, r) => l.startMs - r.startMs,
      );
    const tiled = (clips: { startMs: number; durationMs: number }[]) =>
      clips.every(
        (clip, index) =>
          index === 0 ||
          Math.abs(
            clip.startMs -
              (clips[index - 1]!.startMs + clips[index - 1]!.durationMs),
          ) <= 2,
      );
    const videoOf = (tl: Timeline) =>
      [...tl.tracks[0]!.clips].sort((l, r) => l.startMs - r.startMs);
    expect(tiled(captionsOf(cut))).toBe(true);
    const restored = compileTranscriptRestore({ ...input, timeline: cut });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const next = applyTimelineOps(cut, restored.ops).timeline;
    expect(tiled(captionsOf(next))).toBe(true);
    // Captions and media describe the same timeline windows.
    expect(captionsOf(next).map((c) => [c.startMs, c.durationMs])).toEqual(
      videoOf(next).map((c) => [c.startMs, c.durationMs]),
    );
  });

  it('preserves visual additions on an independent track during restore', () => {
    const cut = cutMiddle(linkedSpeech());
    const visual = clip({
      id: 'added',
      sourceRef: { kind: 'asset', assetId: 'other' },
      startMs: 300,
      durationMs: 200,
      trimEndMs: 200,
    });
    cut.tracks.push({
      id: 'broll',
      kind: 'broll',
      name: 'B',
      order: 2,
      locked: false,
      muted: false,
      clips: [visual as VisualTimelineClip],
    });
    const restore = restoreMiddle(cut);
    expect(restore.ok).toBe(true);
    if (!restore.ok) return;
    expect(
      applyTimelineOps(cut, restore.ops).timeline.tracks.at(-1)!.clips,
    ).toEqual([visual]);
  });

  it.each(['track-video', 'captions'])(
    'rejects cut and restore if %s is locked',
    (trackId) => {
      const original = linkedSpeech();
      original.tracks.find((track) => track.id === trackId)!.locked = true;
      expect(() => cutMiddle(original)).toThrow(
        expect.objectContaining({ code: 'track_locked' }),
      );
      original.tracks.find((track) => track.id === trackId)!.locked = false;
      const cut = cutMiddle(original);
      cut.tracks.find((track) => track.id === trackId)!.locked = true;
      expect(restoreMiddle(cut)).toEqual({ ok: false, reason: 'track-locked' });
    },
  );

  it('refuses a moved-apart or occupied seam and incompatible playback', () => {
    const cut = cutMiddle(timeline([clip({ id: 'v' })]));
    const right = cut.tracks[0]!.clips[1]!;
    right.startMs += 500;
    expect(restoreMiddle(cut)).toEqual({ ok: false, reason: 'seam-not-found' });
    right.startMs -= 500;
    right.playback = { speed: 2, reverse: false };
    expect(restoreMiddle(cut)).toEqual({ ok: false, reason: 'seam-not-found' });
    right.playback = undefined;
    const videoTrack = cut.tracks.find((track) => track.id === 'track-video')!;
    if (videoTrack.kind !== 'video') throw new Error('Expected video track');
    videoTrack.clips.push(
      clip({
        id: 'occupied',
        sourceRef: { kind: 'asset', assetId: 'other' },
        startMs: 250,
        durationMs: 100,
        trimEndMs: 100,
      }) as VisualTimelineClip,
    );
    expect(restoreMiddle(cut)).toEqual({ ok: false, reason: 'seam-not-found' });
  });

  it.each([1, 2])(
    'restores reverse linked speech and captions at %sx',
    (speed) => {
      const cut = cutMiddle(linkedSpeech(speed, true));
      const restore = restoreMiddle(cut);
      expect(restore.ok).toBe(true);
      if (!restore.ok) return;
      const next = applyTimelineOps(cut, restore.ops).timeline;
      for (const track of next.tracks) {
        expect(
          track.clips.map((clip) => [clip.startMs, clip.durationMs]),
        ).toEqual([
          [0, 700 / speed],
          [700 / speed, 300 / speed],
        ]);
      }
      const captions = next.tracks.find(
        (track) => track.kind === 'caption',
      )!.clips;
      expect(captions.map((cue) => cue.text)).toEqual([
        'w9 w8 w7 w6 w5 w4 w3',
        'w2 w1 w0',
      ]);
      expect(captions[0]!.words![4]).toEqual({
        text: 'w5',
        startMs: 400 / speed,
        endMs: 500 / speed,
      });
    },
  );
});
