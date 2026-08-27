import { describe, expect, it } from 'vitest';

import {
  TimelineOpError,
  TimelineOpSchema,
  TimelineSchema,
  applyTimelineOp,
  applyTimelineOps,
  clipPlaybackFromFields,
  collectTimelineOpConflicts,
  effectiveDurationFrames,
  findOutOfSyncGroups,
  localFrameToSourceFrame,
  rippleShiftClips,
  sourceFrameToLocalFrame,
  type AudioTimelineClip,
  type CaptionTimelineClip,
  type Timeline,
  type TimelineClip,
  type TimelineHistoryOperation,
  type TimelineTransition,
  type VisualTimelineClip,
} from '../src';

describe('timeline ops', () => {
  it('applies clip edits and generated inverses restore the timeline', () => {
    const timeline = timelineFixture();
    const insertedClip: TimelineClip = {
      id: 'clip-b',
      kind: 'video',
      sourceRef: { kind: 'asset', assetId: 'asset-b' },
      startMs: 0,
      durationMs: 500,
      trimStartMs: 100,
      trimEndMs: 600,
    };

    const applied = applyTimelineOps(timeline, [
      {
        kind: 'clip.insert',
        trackId: 'track-video',
        clip: insertedClip,
        at: 1000,
      },
      {
        kind: 'clip.move',
        clipId: 'clip-a',
        from: { trackId: 'track-video', startMs: 0 },
        to: { trackId: 'track-overlay', startMs: 250 },
      },
      {
        kind: 'clip.trim',
        clipId: 'clip-b',
        from: {
          startMs: 1000,
          durationMs: 500,
          trimStartMs: 100,
          trimEndMs: 600,
        },
        to: {
          startMs: 1000,
          durationMs: 350,
          trimStartMs: 100,
          trimEndMs: 450,
        },
      },
    ]);

    expect(applied.timeline.durationMs).toBe(1350);
    expect(
      applied.timeline.tracks
        .find((track) => track.id === 'track-overlay')
        ?.clips.find((clip) => clip.id === 'clip-a'),
    ).toMatchObject({ startMs: 250 });

    const restored = applyTimelineOps(applied.timeline, applied.inverses);

    expect(restored.timeline).toEqual(timeline);
  });

  it('does not let audio clips extend timeline duration past the picture', () => {
    const applied = applyTimelineOps(timelineFixture(), [
      {
        kind: 'clip.insert',
        trackId: 'track-audio',
        clip: {
          id: 'clip-music',
          kind: 'audio',
          sourceRef: { kind: 'asset', assetId: 'asset-music' },
          startMs: 0,
          durationMs: 30_000,
          trimStartMs: 0,
          trimEndMs: 30_000,
          sourceDurationMs: 30_000,
        },
        at: 0,
      },
    ]);

    expect(applied.timeline.durationMs).toBe(1000);
  });

  it('round-trips marker and visual-property edits through inverses', () => {
    const transition = applyTimelineOp(timelineFixture(), {
      kind: 'clip.setTransition',
      clipId: 'clip-a',
      before: null,
      after: { kind: 'fade', durationMs: 500 },
    });
    const marker = applyTimelineOp(transition.timeline, {
      kind: 'marker.upsert',
      marker: {
        id: 'marker-1',
        timeMs: 250,
        label: 'Hook',
        color: 'blue',
      },
    });

    expect(marker.timeline.tracks[0]?.clips[0]).toMatchObject({
      transitionToNext: { kind: 'fade', durationMs: 500 },
    });
    expect(marker.timeline.markers).toEqual([
      { id: 'marker-1', timeMs: 250, label: 'Hook', color: 'blue' },
    ]);

    const markerRestored = applyHistoryOperation(
      marker.timeline,
      marker.inverse,
    );
    const restored = applyHistoryOperation(
      markerRestored.timeline,
      transition.inverse,
    );

    expect(restored.timeline).toEqual(timelineFixture());
  });

  it('round-trips audio clip edits and audio transitions through inverses', () => {
    const timeline = linkedTimelineFixture();
    const applied = applyTimelineOps(timeline, [
      {
        kind: 'clip.setAudio',
        clipId: 'clip-audio',
        before: {
          gainDb: -12,
          muted: false,
          fadeInMs: 100,
          fadeOutMs: 100,
        },
        after: {
          gainDb: 3,
          muted: true,
          fadeInMs: 250,
          fadeOutMs: 300,
          fadeInCurve: 'equal-power',
          fadeOutCurve: 'ease-in-out',
        },
      },
      {
        kind: 'clip.setAudioTransition',
        clipId: 'clip-audio',
        before: {
          kind: 'crossfade',
          durationMs: 120,
          curve: 'linear',
        },
        after: {
          kind: 'crossfade',
          durationMs: 240,
          curve: 'equal-power',
        },
      },
    ]);

    const audioClip = applied.timeline.tracks
      .find((track) => track.id === 'track-audio')
      ?.clips.find((clip) => clip.id === 'clip-audio');

    expect(audioClip).toMatchObject({
      gainDb: 3,
      muted: true,
      fadeInMs: 250,
      fadeOutMs: 300,
      fadeInCurve: 'equal-power',
      fadeOutCurve: 'ease-in-out',
      audioTransitionToNext: {
        kind: 'crossfade',
        durationMs: 240,
        curve: 'equal-power',
      },
    });
    expect(TimelineSchema.parse(applied.timeline)).toEqual(applied.timeline);

    const restored = applyTimelineOps(applied.timeline, applied.inverses);

    expect(restored.timeline).toEqual(timeline);
  });

  it('round-trips audio track volume and duck metadata through track update', () => {
    const timeline = linkedTimelineFixture();
    const applied = applyTimelineOp(timeline, {
      kind: 'track.update',
      trackId: 'track-audio',
      before: { volumeDb: -12, duckUnderTrackId: 'stale-track' },
      after: { volumeDb: -6, duckUnderTrackId: 'track-video' },
    });

    expect(
      applied.timeline.tracks.find((track) => track.id === 'track-audio'),
    ).toMatchObject({ volumeDb: -6, duckUnderTrackId: 'track-video' });
    expect(TimelineSchema.parse(applied.timeline)).toEqual(applied.timeline);

    const restored = applyHistoryOperation(applied.timeline, applied.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('round-trips optional track fields back to absence through track update', () => {
    const timeline = timelineFixture();
    const applied = applyTimelineOp(timeline, {
      kind: 'track.update',
      trackId: 'track-video',
      before: {},
      after: { syncLocked: true },
    });

    expect(
      applied.timeline.tracks.find((track) => track.id === 'track-video'),
    ).toMatchObject({ syncLocked: true });

    const restored = applyHistoryOperation(applied.timeline, applied.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('round-trips keyframe edits through generated inverses', () => {
    const timeline = timelineFixture();
    const applied = applyTimelineOps(timeline, [
      {
        kind: 'keyframe.upsert',
        clipId: 'clip-a',
        property: 'opacity',
        key: { atMs: 500, value: 0.25, interp: 'linear' },
      },
      {
        kind: 'keyframe.upsert',
        clipId: 'clip-a',
        property: 'opacity',
        key: { atMs: 0, value: 1, interp: 'hold' },
      },
    ]);

    expect(applied.timeline.tracks[0]?.clips[0]?.keyframes).toEqual([
      {
        property: 'opacity',
        keys: [
          { atMs: 0, value: 1, interp: 'hold' },
          { atMs: 500, value: 0.25, interp: 'linear' },
        ],
      },
    ]);

    const restored = applyTimelineOps(applied.timeline, applied.inverses);

    expect(restored.timeline).toEqual(timeline);
  });

  it('round-trips clip playback edits through generated inverses', () => {
    const timeline = timelineFixture();
    const applied = applyTimelineOp(timeline, {
      kind: 'clip.setPlayback',
      clipId: 'clip-a',
      before: null,
      after: {
        speed: 2,
        reverse: true,
        pitchCorrection: true,
        interpolationQuality: 'high',
      },
      timingPolicy: 'preserve-source-span',
    });

    expect(applied.timeline.tracks[0]?.clips[0]).toMatchObject({
      playback: {
        speed: 2,
        reverse: true,
        pitchCorrection: true,
        interpolationQuality: 'high',
      },
    });
    expect(applied.inverse).toEqual({
      kind: 'clip.setPlayback',
      clipId: 'clip-a',
      before: {
        speed: 2,
        reverse: true,
        pitchCorrection: true,
        interpolationQuality: 'high',
      },
      after: null,
      timingPolicy: 'preserve-source-span',
    });

    const restored = applyHistoryOperation(applied.timeline, applied.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('rejects out-of-range playback speeds at the reducer boundary', () => {
    expect(() =>
      applyTimelineOp(timelineFixture(), {
        kind: 'clip.setPlayback',
        clipId: 'clip-a',
        before: null,
        after: { speed: 0.05, reverse: false },
      }),
    ).toThrow('Clip playback speed must be between 0.1 and 20');
  });

  it('maps clip-local frames through speed and reverse playback', () => {
    expect(
      clipPlaybackFromFields({
        params: { speed: 2, reversePlayback: true },
      }),
    ).toEqual({ speed: 2, reverse: true });
    expect(
      clipPlaybackFromFields({
        playback: {
          speed: 1,
          reverse: false,
          pitchCorrection: true,
        },
      }),
    ).toEqual({
      speed: 1,
      reverse: false,
      pitchCorrection: true,
    });
    expect(
      localFrameToSourceFrame(120, {
        trimStartFrame: 10,
        trimEndFrame: 400,
        playback: { speed: 2, reverse: false },
      }),
    ).toBe(250);
    expect(
      localFrameToSourceFrame(0, {
        trimStartFrame: 10,
        trimEndFrame: 110,
        playback: { speed: 1, reverse: true },
      }),
    ).toBe(109);
    expect(
      sourceFrameToLocalFrame(109, {
        trimStartFrame: 10,
        trimEndFrame: 110,
        playback: { speed: 1, reverse: true },
      }),
    ).toBe(0);
    expect(effectiveDurationFrames(240, { speed: 2, reverse: false })).toBe(
      120,
    );
  });

  it('removes empty keyframe tracks and restores them through inverse', () => {
    const track = {
      property: 'scale' as const,
      keys: [{ atMs: 250, value: 1.2 }],
    };
    const keyed = applyTimelineOp(timelineFixture(), {
      kind: 'keyframe.setTrack',
      clipId: 'clip-a',
      property: 'scale',
      before: null,
      after: track,
    });
    const removed = applyTimelineOp(keyed.timeline, {
      kind: 'keyframe.remove',
      clipId: 'clip-a',
      property: 'scale',
      atMs: 250,
      snapshot: { atMs: 250, value: 1.2 },
    });

    expect(removed.timeline.tracks[0]?.clips[0]?.keyframes).toBeUndefined();

    const restored = applyHistoryOperation(removed.timeline, removed.inverse);

    expect(restored.timeline.tracks[0]?.clips[0]?.keyframes).toEqual([track]);
  });

  it('rejects removing a missing keyframe', () => {
    expect(() =>
      applyTimelineOp(timelineFixture(), {
        kind: 'keyframe.remove',
        clipId: 'clip-a',
        property: 'scale',
        atMs: 250,
        snapshot: { atMs: 250, value: 1.2 },
      }),
    ).toThrow(TimelineOpError);
  });

  it('uses a merge inverse for split operations', () => {
    const timeline = timelineFixture();
    const before = timeline.tracks[0]!.clips[0]!;
    const left: TimelineClip = {
      ...before,
      id: 'clip-a-left',
      durationMs: 400,
      trimEndMs: 400,
    };
    const right: TimelineClip = {
      ...before,
      id: 'clip-a-right',
      startMs: 400,
      durationMs: 600,
      trimStartMs: 400,
      trimEndMs: 1000,
    };
    const split = applyTimelineOp(timeline, {
      kind: 'clip.split',
      clipId: 'clip-a',
      at: 400,
      before,
      after: [left, right],
    });

    expect(split.timeline.tracks[0]?.clips.map((clip) => clip.id)).toEqual([
      'clip-a-left',
      'clip-a-right',
    ]);
    expect(split.inverse).toEqual({
      kind: 'clip.merge',
      removeClipIds: ['clip-a-left', 'clip-a-right'],
      clip: before,
    });

    const restored = applyHistoryOperation(split.timeline, split.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('re-clamps visual transitions when trimming a neighboring seam clip', () => {
    const transition: TimelineTransition = {
      kind: 'fade',
      durationMs: 800,
      params: { easing: 'ease-in-out' },
      source: { kind: 'builtin', id: 'fade-soft' },
    };
    const timeline = transitionedPrimaryTimelineFixture(transition);
    const trimmed = applyTimelineOp(timeline, {
      kind: 'clip.trim',
      clipId: 'clip-b',
      from: {
        startMs: 1000,
        durationMs: 1000,
        trimStartMs: 0,
        trimEndMs: 1000,
      },
      to: {
        startMs: 1000,
        durationMs: 300,
        trimStartMs: 0,
        trimEndMs: 300,
      },
    });

    expect(visualClipById(trimmed.timeline, 'clip-a')).toMatchObject({
      transitionToNext: {
        kind: 'fade',
        durationMs: 150,
        params: { easing: 'ease-in-out' },
        source: { kind: 'builtin', id: 'fade-soft' },
      },
    });
    expect(
      applyHistoryOperation(trimmed.timeline, trimmed.inverse).timeline,
    ).toEqual(timeline);
  });

  it('includes preset max duration when re-clamping visual transitions', () => {
    const timeline = longTransitionTimelineFixture({
      kind: 'cube',
      durationMs: 2500,
    });
    const trimmed = applyTimelineOp(timeline, {
      kind: 'clip.trim',
      clipId: 'clip-b',
      from: {
        startMs: 5000,
        durationMs: 5000,
        trimStartMs: 0,
        trimEndMs: 5000,
      },
      to: {
        startMs: 5000,
        durationMs: 4000,
        trimStartMs: 0,
        trimEndMs: 4000,
      },
    });

    expect(visualClipById(trimmed.timeline, 'clip-a')).toMatchObject({
      transitionToNext: { kind: 'cube', durationMs: 1500 },
    });
    expect(
      applyHistoryOperation(trimmed.timeline, trimmed.inverse).timeline,
    ).toEqual(timeline);
  });

  it('clears visual transitions when moving the next clip breaks adjacency', () => {
    const timeline = transitionedPrimaryTimelineFixture({
      kind: 'wipe',
      durationMs: 500,
    });
    const moved = applyTimelineOp(timeline, {
      kind: 'clip.move',
      clipId: 'clip-b',
      from: { trackId: 'track-video', startMs: 1000 },
      to: { trackId: 'track-video', startMs: 1500 },
    });

    expect(
      visualClipById(moved.timeline, 'clip-a').transitionToNext,
    ).toBeUndefined();
    expect(
      applyHistoryOperation(moved.timeline, moved.inverse).timeline,
    ).toEqual(timeline);
  });

  it('clears visual transitions when deleting the next clip breaks adjacency', () => {
    const timeline = transitionedPrimaryTimelineFixture({
      kind: 'slide',
      durationMs: 500,
    });
    const removed = applyTimelineOp(timeline, {
      kind: 'clip.remove',
      clipId: 'clip-b',
    });

    expect(
      visualClipById(removed.timeline, 'clip-a').transitionToNext,
    ).toBeUndefined();
    expect(
      applyHistoryOperation(removed.timeline, removed.inverse).timeline,
    ).toEqual(timeline);
  });

  it('moves an outgoing split transition to the piece touching the original next clip', () => {
    const timeline = transitionedPrimaryTimelineFixture({
      kind: 'dissolve',
      durationMs: 200,
      params: { softness: 0.7 },
      seam: { sourceClipId: 'clip-a', targetClipId: 'clip-b' },
    });
    const before = visualClipById(timeline, 'clip-a');
    const left: TimelineClip = {
      ...before,
      id: 'clip-a-left',
      durationMs: 400,
      trimEndMs: 400,
    };
    const right: TimelineClip = {
      ...before,
      id: 'clip-a-right',
      startMs: 400,
      durationMs: 600,
      trimStartMs: 400,
      trimEndMs: 1000,
    };
    const split = applyTimelineOp(timeline, {
      kind: 'clip.split',
      clipId: 'clip-a',
      at: 400,
      before,
      after: [left, right],
    });

    expect(
      visualClipById(split.timeline, 'clip-a-left').transitionToNext,
    ).toBeUndefined();
    expect(visualClipById(split.timeline, 'clip-a-right')).toMatchObject({
      transitionToNext: {
        kind: 'dissolve',
        durationMs: 200,
        params: { softness: 0.7 },
        seam: { sourceClipId: 'clip-a', targetClipId: 'clip-b' },
      },
    });
    expect(
      applyHistoryOperation(split.timeline, split.inverse).timeline,
    ).toEqual(timeline);
  });

  it('applies magnetic remove and insert inverses without leaving gaps', () => {
    const timeline = primaryTimelineFixture();
    const removed = applyTimelineOp(timeline, {
      kind: 'clip.remove',
      clipId: 'clip-b',
      magnetic: true,
    });

    expect(
      removed.timeline.tracks[0]?.clips.map((clip) => [clip.id, clip.startMs]),
    ).toEqual([
      ['clip-a', 0],
      ['clip-c', 1000],
    ]);
    expect(removed.timeline.durationMs).toBe(2000);

    const restored = applyHistoryOperation(removed.timeline, removed.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('extends a primary clip and ripples downstream clips through inverse', () => {
    const timeline = primaryTimelineFixture();
    const extended = applyTimelineOp(timeline, {
      kind: 'clip.extend',
      clipId: 'clip-a',
      deltaMs: 500,
      magnetic: true,
    });

    expect(
      extended.timeline.tracks[0]?.clips.map((clip) => [
        clip.id,
        clip.startMs,
        clip.durationMs,
      ]),
    ).toEqual([
      ['clip-a', 0, 1500],
      ['clip-b', 1500, 1000],
      ['clip-c', 2500, 1000],
    ]);

    const restored = applyHistoryOperation(extended.timeline, extended.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('trims clip handles when a negative ripple would cross time zero', () => {
    const shifted = rippleShiftClips(
      [
        {
          id: 'clip-near-zero',
          kind: 'video',
          sourceRef: { kind: 'asset', assetId: 'asset-a' },
          startMs: 100,
          durationMs: 1000,
          trimStartMs: 200,
          trimEndMs: 1200,
        },
      ],
      { fromMs: 0, deltaMs: -250 },
    );

    expect(shifted[0]).toMatchObject({
      startMs: 0,
      durationMs: 850,
      trimStartMs: 350,
      trimEndMs: 1200,
    });
  });

  it('removes a time range magnetically and restores from snapshots', () => {
    const timeline = primaryTimelineFixture();
    const removed = applyTimelineOp(timeline, {
      kind: 'clip.removeTimeRange',
      startMs: 1000,
      endMs: 2000,
      magnetic: true,
    });

    expect(
      removed.timeline.tracks[0]?.clips.map((clip) => [clip.id, clip.startMs]),
    ).toEqual([
      ['clip-a', 0],
      ['clip-c', 1000],
    ]);
    expect(removed.inverse).toMatchObject({
      kind: 'clip.removeTimeRange',
      before: [expect.objectContaining({ id: 'clip-c', startMs: 1000 })],
      after: [
        expect.objectContaining({ id: 'clip-b', startMs: 1000 }),
        expect.objectContaining({ id: 'clip-c', startMs: 2000 }),
      ],
    });

    const restored = applyHistoryOperation(removed.timeline, removed.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('requires explicit replacement clips when a time range splits a clip', () => {
    expect(() =>
      applyTimelineOp(primaryTimelineFixture(), {
        kind: 'clip.removeTimeRange',
        startMs: 250,
        endMs: 750,
        magnetic: true,
      }),
    ).toThrow(TimelineOpError);
  });

  it('applies caption token edits, split/merge, and regroup inverses', () => {
    const timeline = captionTimelineFixture();
    const tokenEdit = applyTimelineOp(timeline, {
      kind: 'caption.setTokenText',
      clipId: 'caption-a',
      tokenId: 'token-2',
      before: 'world',
      after: 'there',
    });

    expect(tokenEdit.timeline.tracks[0]?.clips[0]).toMatchObject({
      id: 'caption-a',
      text: 'Hello there',
      tokens: [
        { id: 'token-1', text: 'Hello' },
        { id: 'token-2', text: 'there' },
      ],
    });
    expect(
      applyHistoryOperation(tokenEdit.timeline, tokenEdit.inverse).timeline,
    ).toEqual(timeline);

    const before = timeline.tracks[0]!.clips[0] as CaptionTimelineClip;
    const left: CaptionTimelineClip = {
      ...before,
      id: 'caption-left',
      text: 'Hello',
      durationMs: 500,
      trimEndMs: 500,
      tokens: [before.tokens![0]!],
    };
    const right: CaptionTimelineClip = {
      ...before,
      id: 'caption-right',
      text: 'world',
      startMs: 500,
      durationMs: 500,
      trimStartMs: 500,
      tokens: [before.tokens![1]!],
    };
    const split = applyTimelineOp(timeline, {
      kind: 'caption.splitAtTime',
      clipId: 'caption-a',
      at: 500,
      before,
      after: [left, right],
    });

    expect(split.timeline.tracks[0]?.clips.map((clip) => clip.id)).toEqual([
      'caption-left',
      'caption-right',
    ]);
    expect(
      applyHistoryOperation(split.timeline, split.inverse).timeline,
    ).toEqual(timeline);

    const regrouped = applyTimelineOp(timeline, {
      kind: 'caption.regroup',
      trackId: 'track-caption',
      before: [before],
      after: [left, right],
    });

    expect(regrouped.timeline.tracks[0]?.clips).toHaveLength(2);
    expect(
      applyHistoryOperation(regrouped.timeline, regrouped.inverse).timeline,
    ).toEqual(timeline);
  });

  it('links clips and restores previous link state through inverses', () => {
    const timeline = unlinkedTimelineFixture();
    const linked = applyTimelineOp(timeline, {
      kind: 'clip.link',
      clipIds: ['clip-video', 'clip-audio'],
      linkGroupId: 'av-1',
    });

    expect(linked.timeline.tracks[0]?.clips[0]).toMatchObject({
      linkGroupId: 'av-1',
    });
    expect(linked.timeline.tracks[1]?.clips[0]).toMatchObject({
      linkGroupId: 'av-1',
    });

    const restored = applyHistoryOperation(linked.timeline, linked.inverse);

    expect(restored.timeline).toEqual(timeline);
  });

  it('restores prior link membership when relinking a clip from another group', () => {
    // clip-video & clip-audio share 'av-1'; clip-extra is unlinked.
    const timeline = linkedTimelineFixture({
      extraAudioClip: audioClip('clip-extra', 0),
    });
    const relinked = applyTimelineOp(timeline, {
      kind: 'clip.link',
      clipIds: ['clip-video', 'clip-extra'],
      linkGroupId: 'av-2',
    });

    expect(relinked.timeline.tracks[0]?.clips[0]).toMatchObject({
      linkGroupId: 'av-2',
    });

    // Undo must not throw (regression: the old clip.link inverse tripped its
    // two-clip minimum) and must restore clip-video to 'av-1', clip-extra to
    // unlinked, while clip-audio stays in 'av-1'.
    const restored = applyHistoryOperation(relinked.timeline, relinked.inverse);
    expect(restored.timeline).toEqual(timeline);
  });

  it('ignores a stale before on keyframe.upsert so undo removes a fresh insert', () => {
    const inserted = applyTimelineOp(timelineFixture(), {
      kind: 'keyframe.upsert',
      clipId: 'clip-a',
      property: 'opacity',
      key: { atMs: 400, value: 0.5, interp: 'linear' },
      // Stale: no key exists at 400ms, so the inverse must be a remove.
      before: { atMs: 400, value: 0.1, interp: 'linear' },
    });

    expect(inserted.inverse).toMatchObject({
      kind: 'keyframe.remove',
      atMs: 400,
    });
    const restored = applyHistoryOperation(inserted.timeline, inserted.inverse);
    expect(restored.timeline.tracks[0]?.clips[0]?.keyframes).toBeUndefined();
  });

  it('ignores a stale before on keyframe.setTrack so undo clears a new track', () => {
    const set = applyTimelineOp(timelineFixture(), {
      kind: 'keyframe.setTrack',
      clipId: 'clip-a',
      property: 'scale',
      // Stale: the clip has no scale track, so the inverse must clear it.
      before: { property: 'scale', keys: [{ atMs: 0, value: 9 }] },
      after: { property: 'scale', keys: [{ atMs: 100, value: 1.5 }] },
    });

    expect(set.inverse).toMatchObject({
      kind: 'keyframe.setTrack',
      after: null,
    });
    const restored = applyHistoryOperation(set.timeline, set.inverse);
    expect(restored.timeline.tracks[0]?.clips[0]?.keyframes).toBeUndefined();
  });

  it('moves and trims linked partners with one undoable inverse', () => {
    const timeline = linkedTimelineFixture();
    const moved = applyTimelineOp(timeline, {
      kind: 'clip.move',
      clipId: 'clip-video',
      from: { trackId: 'track-video', startMs: 0 },
      to: { trackId: 'track-video', startMs: 500 },
    });

    expect(moved.timeline.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-video',
      startMs: 500,
    });
    expect(moved.timeline.tracks[1]?.clips[0]).toMatchObject({
      id: 'clip-audio',
      startMs: 500,
    });
    expect(
      applyHistoryOperation(moved.timeline, moved.inverse).timeline,
    ).toEqual(timeline);

    const trimmed = applyTimelineOp(timeline, {
      kind: 'clip.trim',
      clipId: 'clip-video',
      from: {
        startMs: 0,
        durationMs: 1000,
        trimStartMs: 0,
        trimEndMs: 1000,
      },
      to: {
        startMs: 100,
        durationMs: 800,
        trimStartMs: 100,
        trimEndMs: 900,
      },
    });

    expect(trimmed.timeline.tracks[0]?.clips[0]).toMatchObject({
      startMs: 100,
      durationMs: 800,
      trimStartMs: 100,
      trimEndMs: 900,
    });
    expect(trimmed.timeline.tracks[1]?.clips[0]).toMatchObject({
      startMs: 100,
      durationMs: 800,
      trimStartMs: 100,
      trimEndMs: 900,
    });
    expect(
      applyHistoryOperation(trimmed.timeline, trimmed.inverse).timeline,
    ).toEqual(timeline);
  });

  it('removes a linked group and restores all partners with one inverse', () => {
    const timeline = linkedTimelineFixture();
    const removed = applyTimelineOp(timeline, {
      kind: 'clip.remove',
      clipId: 'clip-video',
    });

    expect(removed.timeline.tracks[0]?.clips).toEqual([]);
    expect(removed.timeline.tracks[1]?.clips).toEqual([]);
    expect(removed.inverse).toMatchObject({ kind: 'timeline.batch' });
    expect(
      applyHistoryOperation(removed.timeline, removed.inverse).timeline,
    ).toEqual(timeline);
  });

  it('reports sync-lock collisions without applying the unsafe edit', () => {
    const timeline = linkedTimelineFixture({
      syncLockedAudio: true,
      extraAudioClip: audioClip('clip-bed', 1200),
    });

    const conflicts = collectTimelineOpConflicts(timeline, [
      {
        kind: 'clip.move',
        clipId: 'clip-video',
        from: { trackId: 'track-video', startMs: 0 },
        to: { trackId: 'track-video', startMs: 500 },
      },
    ]);

    expect(conflicts).toEqual([
      expect.objectContaining({
        clipId: 'clip-bed',
        reason: 'sync-lock',
      }),
    ]);
  });

  it('detects out-of-sync link groups', () => {
    expect(
      findOutOfSyncGroups(
        linkedTimelineFixture({
          audioStartMs: 100,
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        linkGroupId: 'av-1',
        clipIds: ['clip-video', 'clip-audio'],
        driftMs: 100,
      }),
    ]);
  });

  it('does not block out-of-sync groups unless a linked track is sync-locked', () => {
    const timeline = unlinkedTimelineFixture({ audioStartMs: 100 });

    expect(
      collectTimelineOpConflicts(timeline, [
        {
          kind: 'clip.link',
          clipIds: ['clip-video', 'clip-audio'],
          linkGroupId: 'av-1',
        },
      ]),
    ).toEqual([]);
  });

  it('rejects clips on incompatible tracks', () => {
    expect(() =>
      applyTimelineOp(timelineFixture(), {
        kind: 'clip.insert',
        trackId: 'track-audio',
        clip: {
          id: 'clip-bad',
          kind: 'video',
          sourceRef: { kind: 'asset', assetId: 'asset-video' },
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
        },
        at: 0,
      }),
    ).toThrow(TimelineOpError);
  });

  it('validates timeline and op payloads at the boundary', () => {
    expect(TimelineSchema.parse(timelineFixture())).toEqual(timelineFixture());
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.move',
        clipId: 'clip-a',
        from: { trackId: 'track-video', startMs: 0 },
        to: { trackId: 'track-overlay', startMs: 250 },
        magnetic: true,
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setTransition',
        clipId: 'clip-a',
        before: null,
        after: {
          kind: 'fade',
          durationMs: 300,
          seam: {
            sourceClipId: 'clip-a',
            targetClipId: 'clip-b',
            timeMs: 1000,
          },
          params: { easing: 'ease-in-out' },
          source: { kind: 'builtin', id: 'fade' },
        },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setAudio',
        clipId: 'clip-audio',
        before: {},
        after: {
          gainDb: 3,
          muted: true,
          fadeInMs: 250,
          fadeOutMs: 300,
          fadeInCurve: 'equal-power',
          fadeOutCurve: 'ease-in-out',
        },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setAudio',
        clipId: 'clip-audio',
        before: { gainDb: 3, muted: true },
        after: { gainDb: null, muted: null },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setAudioTransition',
        clipId: 'clip-audio',
        before: null,
        after: {
          kind: 'crossfade',
          durationMs: 240,
          curve: 'equal-power',
        },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.link',
        clipIds: ['clip-a', 'caption-a'],
        linkGroupId: 'group-1',
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'track.update',
        trackId: 'track-video',
        before: { syncLocked: false },
        after: { syncLocked: true },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'track.update',
        trackId: 'track-video',
        before: { syncLocked: true },
        after: { syncLocked: null },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'track.update',
        trackId: 'track-audio',
        before: { volumeDb: null, duckUnderTrackId: null },
        after: { volumeDb: -6, duckUnderTrackId: 'track-video' },
      }).success,
    ).toBe(true);
    expect(
      TimelineSchema.safeParse({
        ...captionTimelineFixture(),
        tracks: [
          {
            ...captionTimelineFixture().tracks[0]!,
            syncLocked: true,
            clips: [
              {
                ...captionTimelineFixture().tracks[0]!.clips[0]!,
                captionGroupId: 'captions-1',
                linkGroupId: 'captions-link',
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setTransform',
        clipId: 'clip-a',
        before: null,
        after: {
          fit: 'contain',
          scaleX: 1,
          scaleY: 1,
          positionX: 0.5,
          positionY: 0.5,
        },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setPlayback',
        clipId: 'clip-a',
        before: null,
        after: {
          speed: 2,
          reverse: true,
          pitchCorrection: true,
          interpolationQuality: 'high',
        },
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setPlayback',
        clipId: 'clip-a',
        before: null,
        after: {
          speed: 0.05,
          reverse: false,
        },
      }).success,
    ).toBe(false);
    expect(
      TimelineSchema.safeParse({
        ...timelineFixture(),
        tracks: [
          {
            ...timelineFixture().tracks[0]!,
            clips: [
              {
                ...timelineFixture().tracks[0]!.clips[0]!,
                keyframes: [
                  {
                    property: 'opacity',
                    keys: [
                      { atMs: 0, value: 1, interp: 'linear' },
                      { atMs: 500, value: 0.25 },
                    ],
                  },
                ],
              },
            ],
          },
          ...timelineFixture().tracks.slice(1),
        ],
      }).success,
    ).toBe(true);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'keyframe.setTrack',
        clipId: 'clip-a',
        property: 'opacity',
        before: null,
        after: {
          property: 'opacity',
          keys: [
            { atMs: 500, value: 0.5 },
            { atMs: 250, value: 1 },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      TimelineOpSchema.safeParse({
        kind: 'keyframe.upsert',
        clipId: 'clip-a',
        property: 'opacity',
        key: { atMs: 250, value: 2 },
      }).success,
    ).toBe(false);
  });
});

function timelineFixture(): Timeline {
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
        clips: [
          {
            id: 'clip-a',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-a' },
            startMs: 0,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
          },
        ],
      },
      {
        id: 'track-overlay',
        kind: 'overlay',
        name: 'Overlay',
        muted: false,
        locked: false,
        order: 10,
        clips: [],
      },
      {
        id: 'track-audio',
        kind: 'audio-vo',
        name: 'Voiceover',
        muted: false,
        locked: false,
        order: 20,
        clips: [],
      },
    ],
  };
}

function primaryTimelineFixture(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 3000,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          videoClip('clip-a', 0),
          videoClip('clip-b', 1000),
          videoClip('clip-c', 2000),
        ],
      },
    ],
  };
}

function transitionedPrimaryTimelineFixture(
  transition: TimelineTransition,
): Timeline {
  const timeline = primaryTimelineFixture();
  const videoTrack = timeline.tracks[0]!;
  if (videoTrack.kind !== 'video') {
    throw new Error('fixture expects a video track first');
  }
  return {
    ...timeline,
    tracks: [
      {
        ...videoTrack,
        clips: videoTrack.clips.map((clip) =>
          clip.id === 'clip-a' && clip.kind !== 'effect'
            ? { ...clip, transitionToNext: transition }
            : clip,
        ),
      },
    ],
  };
}

function longTransitionTimelineFixture(
  transition: TimelineTransition,
): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 15000,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            ...videoClip('clip-a', 0),
            durationMs: 5000,
            trimEndMs: 5000,
            transitionToNext: transition,
          },
          {
            ...videoClip('clip-b', 5000),
            durationMs: 5000,
            trimEndMs: 5000,
          },
          {
            ...videoClip('clip-c', 10000),
            durationMs: 5000,
            trimEndMs: 5000,
          },
        ],
      },
    ],
  };
}

function videoClip(id: string, startMs: number): VisualTimelineClip {
  return {
    id,
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: id },
    startMs,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    sourceDurationMs: 2000,
  };
}

function visualClipById(
  timeline: Timeline,
  clipId: string,
): VisualTimelineClip {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (
      clip?.kind === 'video' ||
      clip?.kind === 'image' ||
      clip?.kind === 'overlay'
    ) {
      return clip;
    }
  }
  throw new Error(`Visual clip not found: ${clipId}`);
}

function captionTimelineFixture(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 1000,
    tracks: [
      {
        id: 'track-caption',
        kind: 'caption',
        name: 'Captions',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            id: 'caption-a',
            kind: 'caption',
            sourceRef: { kind: 'scene', sceneId: 'scene-a' },
            startMs: 0,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
            text: 'Hello world',
            tokens: [
              { id: 'token-1', text: 'Hello', startMs: 0, endMs: 500 },
              { id: 'token-2', text: 'world', startMs: 500, endMs: 1000 },
            ],
          },
        ],
      },
    ],
  };
}

function unlinkedTimelineFixture(
  options: Parameters<typeof linkedTimelineFixture>[0] = {},
): Timeline {
  return linkedTimelineFixture({ ...options, linked: false });
}

function linkedTimelineFixture(
  options: {
    linked?: boolean;
    syncLockedAudio?: boolean;
    audioStartMs?: number;
    extraAudioClip?: AudioTimelineClip;
  } = {},
): Timeline {
  const linked = options.linked ?? true;
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
        clips: [
          {
            ...videoClip('clip-video', 0),
            ...(linked ? { linkGroupId: 'av-1' } : {}),
          },
        ],
      },
      {
        id: 'track-audio',
        kind: 'audio-vo',
        name: 'Voice',
        muted: false,
        locked: false,
        syncLocked: options.syncLockedAudio,
        order: 1,
        clips: [
          {
            ...audioClip('clip-audio', options.audioStartMs ?? 0),
            ...(linked ? { linkGroupId: 'av-1' } : {}),
          },
          ...(options.extraAudioClip ? [options.extraAudioClip] : []),
        ],
      },
    ],
  };
}

function audioClip(id: string, startMs: number): AudioTimelineClip {
  return {
    id,
    kind: 'audio',
    sourceRef: { kind: 'asset', assetId: id },
    startMs,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    sourceDurationMs: 2000,
  };
}

function applyHistoryOperation(
  timeline: Timeline,
  operation: TimelineHistoryOperation,
): { timeline: Timeline } {
  if (operation.kind === 'timeline.batch') {
    return applyTimelineOps(timeline, operation.ops);
  }
  return applyTimelineOp(timeline, operation);
}
