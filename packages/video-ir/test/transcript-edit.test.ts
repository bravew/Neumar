import { describe, expect, it } from 'vitest';

import {
  applyTimelineOps,
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
