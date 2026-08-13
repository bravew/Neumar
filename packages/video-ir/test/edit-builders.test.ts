import { describe, expect, it } from 'vitest';

import {
  applyTimelineOps,
  buildCrossfadeAudioClipsOps,
  buildCloseGapOps,
  buildCutClipOps,
  buildCutRangeOps,
  buildDeleteClipsOps,
  buildDuplicateClipsOps,
  buildDuckAudioOps,
  buildFlipClipOps,
  buildMoveClipOps,
  buildReplaceAudioClipSourceOps,
  buildReverseClipOps,
  buildRotateClipOps,
  buildSetAudioClipFadeOps,
  buildSetAudioClipGainOps,
  buildSetAudioClipMuteOps,
  buildSetAudioTrackMuteOps,
  buildSetAudioTrackVolumeOps,
  buildSetAudioTransitionOps,
  buildSetAudioVolumeKeyframesOps,
  buildSetClipSpeedOps,
  buildSetClipTransformOps,
  buildTrimClipOps,
  type AudioTimelineClip,
  type Timeline,
  type VisualTimelineClip,
} from '../src/index.js';

describe('edit builders', () => {
  it('builds playback-aware split ops from project frames', () => {
    const timeline = timelineFixture({
      playback: { speed: 2, reverse: false },
      trimEndMs: 60_000,
      sourceDurationMs: 60_000,
    });

    const result = buildCutClipOps(
      timeline,
      {
        clipId: 'clip-video',
        atFrame: 120,
        linkPolicy: 'primary-only',
      },
      { idFactory: idFactory('left', 'right') },
    );

    expect(result.ops).toHaveLength(1);
    expect(result.metadata.createdClipIds).toEqual(['left', 'right']);
    expect(result.ops[0]).toMatchObject({
      kind: 'clip.split',
      clipId: 'clip-video',
      at: 12_000,
      after: [
        {
          id: 'left',
          durationMs: 12_000,
          trimStartMs: 0,
          trimEndMs: 24_000,
          playback: { speed: 2, reverse: false },
        },
        {
          id: 'right',
          startMs: 12_000,
          durationMs: 18_000,
          trimStartMs: 24_000,
          trimEndMs: 60_000,
          playback: { speed: 2, reverse: false },
        },
      ],
    });

    const applied = applyTimelineOps(timeline, result.ops);

    expect(applied.timeline.tracks[0]?.clips).toHaveLength(2);
  });

  it('duplicates linked clips with deterministic clip and link IDs', () => {
    const timeline = linkedTimelineFixture();

    const result = buildDuplicateClipsOps(
      timeline,
      {
        clipIds: ['clip-video', 'clip-audio'],
        linkPolicy: 'linked',
        placement: { kind: 'after-originals' },
      },
      { idFactory: idFactory('link-copy', 'video-copy', 'audio-copy') },
    );

    expect(result.ops).toHaveLength(2);
    expect(result.metadata.createdClipIds).toEqual([
      'video-copy',
      'audio-copy',
    ]);
    expect(result.ops).toMatchObject([
      {
        kind: 'clip.insert',
        trackId: 'track-video',
        at: 30_000,
        clip: {
          id: 'video-copy',
          startMs: 30_000,
          linkGroupId: 'link-copy',
          playback: { speed: 1.5, reverse: false },
          keyframes: [
            {
              property: 'opacity',
              keys: [{ atMs: 500, value: 0.5 }],
            },
          ],
        },
      },
      {
        kind: 'clip.insert',
        trackId: 'track-audio',
        at: 30_000,
        clip: {
          id: 'audio-copy',
          startMs: 30_000,
          linkGroupId: 'link-copy',
        },
      },
    ]);

    const applied = applyTimelineOps(timeline, result.ops);
    const restored = applyTimelineOps(applied.timeline, applied.inverses);
    expect(restored.timeline).toEqual(timeline);
  });

  it('cuts linked clips with retain-left using one remove per new link group', () => {
    const timeline = linkedTimelineFixture();

    const result = buildCutClipOps(
      timeline,
      {
        clipId: 'clip-video',
        atFrame: 100,
        retain: 'left',
        linkPolicy: 'linked',
      },
      {
        idFactory: idFactory(
          'left-link',
          'right-link',
          'video-left',
          'video-right',
          'audio-left',
          'audio-right',
        ),
      },
    );

    expect(result.ops).toHaveLength(3);
    expect(result.ops[2]).toMatchObject({
      kind: 'clip.remove',
      clipId: 'video-right',
      snapshot: { linkGroupId: 'right-link' },
    });
    expect(result.metadata.removedClipIds).toEqual([
      'video-right',
      'audio-right',
    ]);

    const applied = applyTimelineOps(timeline, result.ops);
    const clipIds: string[] = [];
    for (const track of applied.timeline.tracks) {
      for (const clip of track.clips) {
        clipIds.push(clip.id);
      }
    }

    expect(clipIds.sort()).toEqual(['audio-left', 'video-left']);
  });

  it('builds delete and move ops with frame metadata', () => {
    const timeline = twoClipTimelineFixture();

    const deleteResult = buildDeleteClipsOps(timeline, {
      clipIds: ['clip-video'],
      ripple: true,
    });
    expect(deleteResult.ops).toEqual([
      {
        kind: 'clip.remove',
        clipId: 'clip-video',
        snapshot: timeline.tracks[0]?.clips[0],
        magnetic: true,
      },
    ]);
    expect(deleteResult.metadata.removedClipIds).toEqual(['clip-video']);

    const moveResult = buildMoveClipOps(timeline, {
      clipId: 'clip-b',
      toFrame: 100,
    });
    expect(moveResult.ops).toMatchObject([
      {
        kind: 'clip.move',
        clipId: 'clip-b',
        to: { trackId: 'track-video', startMs: 10_000 },
      },
    ]);
    expect(moveResult.metadata.affectedRange).toEqual({
      startFrame: 100,
      endFrame: 650,
    });
  });

  it('builds range cuts and close-gap moves from project frames', () => {
    const timeline = twoClipTimelineFixture();

    expect(
      buildCutRangeOps(timeline, {
        trackId: 'track-video',
        startFrame: 30,
        endFrame: 60,
        ripple: true,
      }).ops,
    ).toEqual([
      {
        kind: 'clip.removeTimeRange',
        trackId: 'track-video',
        startMs: 3_000,
        endMs: 6_000,
        magnetic: true,
      },
    ]);

    const closeGap = buildCloseGapOps(timeline, {
      trackId: 'track-video',
      gapStartFrame: 300,
      gapEndFrame: 350,
    });

    expect(closeGap.ops).toEqual([
      {
        kind: 'clip.move',
        clipId: 'clip-b',
        from: { trackId: 'track-video', startMs: 35_000 },
        to: { trackId: 'track-video', startMs: 30_000 },
      },
    ]);
    expect(closeGap.metadata.shiftedClipIds).toEqual(['clip-b']);
  });

  it('trims reversed clips through playback mapping', () => {
    const timeline = timelineFixture({
      playback: { speed: 1, reverse: true },
    });

    const result = buildTrimClipOps(timeline, {
      clipId: 'clip-video',
      edge: 'left',
      deltaFrames: 10,
    });

    expect(result.ops).toMatchObject([
      {
        kind: 'clip.trim',
        clipId: 'clip-video',
        to: {
          startMs: 1_000,
          durationMs: 29_000,
          trimStartMs: 0,
          trimEndMs: 29_000,
        },
      },
    ]);
  });

  it('extends clip edges with signed trim deltas', () => {
    const timeline = timelineFixture({
      startMs: 1_000,
      durationMs: 10_000,
      trimStartMs: 1_000,
      trimEndMs: 11_000,
      sourceDurationMs: 20_000,
    });

    const left = buildTrimClipOps(timeline, {
      clipId: 'clip-video',
      edge: 'left',
      deltaFrames: -5,
    });
    expect(left.ops).toMatchObject([
      {
        kind: 'clip.trim',
        to: {
          startMs: 500,
          durationMs: 10_500,
          trimStartMs: 500,
          trimEndMs: 11_000,
        },
      },
    ]);

    const right = buildTrimClipOps(timeline, {
      clipId: 'clip-video',
      edge: 'right',
      deltaFrames: -5,
    });
    expect(right.ops).toMatchObject([
      {
        kind: 'clip.trim',
        to: {
          startMs: 1_000,
          durationMs: 10_500,
          trimStartMs: 1_000,
          trimEndMs: 11_500,
        },
      },
    ]);
  });

  it('extends still-image clips beyond finite source metadata', () => {
    const timeline = timelineFixture({
      kind: 'image',
      name: 'Still',
      durationMs: 3_000,
      trimEndMs: 3_000,
      sourceDurationMs: 3_000,
    });

    const result = buildTrimClipOps(timeline, {
      clipId: 'clip-video',
      edge: 'right',
      deltaFrames: -10,
    });
    const applied = applyTimelineOps(timeline, result.ops);

    expect(result.ops).toMatchObject([
      {
        kind: 'clip.trim',
        to: {
          startMs: 0,
          durationMs: 4_000,
          trimStartMs: 0,
          trimEndMs: 4_000,
        },
      },
    ]);
    expect(applied.timeline.tracks[0]?.clips[0]).toMatchObject({
      kind: 'image',
      durationMs: 4_000,
      trimEndMs: 4_000,
      sourceDurationMs: 4_000,
    });
  });

  it('builds speed and reverse playback ops', () => {
    const timeline = timelineFixture();

    const speed = buildSetClipSpeedOps(timeline, {
      clipIds: ['clip-video'],
      speed: 2,
      timingPolicy: 'preserve-source-span',
      ripple: true,
    });
    expect(speed.ops).toMatchObject([
      {
        kind: 'clip.setPlayback',
        clipId: 'clip-video',
        after: { speed: 2, reverse: false },
        timingPolicy: 'preserve-source-span',
      },
      {
        kind: 'clip.trim',
        clipId: 'clip-video',
        to: {
          startMs: 0,
          durationMs: 15_000,
          trimStartMs: 0,
          trimEndMs: 30_000,
        },
        magnetic: true,
      },
    ]);

    const reverse = buildReverseClipOps(timeline, {
      clipIds: ['clip-video'],
      reverse: true,
    });
    expect(reverse.ops).toMatchObject([
      {
        kind: 'clip.setPlayback',
        clipId: 'clip-video',
        after: { speed: 1, reverse: true },
      },
    ]);
  });

  it('builds rotate, flip, and transform ops for visual clips', () => {
    const timeline = timelineFixture({
      transforms: { scale: 1.25, rotation: 15 },
    });

    expect(
      buildRotateClipOps(timeline, {
        clipIds: ['clip-video'],
        degrees: 90,
        relative: true,
      }).ops,
    ).toMatchObject([
      {
        kind: 'clip.setTransform',
        after: { scale: 1.25, rotation: 105 },
      },
    ]);

    expect(
      buildFlipClipOps(timeline, {
        clipIds: ['clip-video'],
        horizontal: true,
      }).ops,
    ).toMatchObject([
      {
        kind: 'clip.setTransform',
        after: { scale: 1.25, scaleX: -1.25, rotation: 15 },
      },
    ]);

    expect(
      buildSetClipTransformOps(timeline, {
        clipIds: ['clip-video'],
        transform: { opacity: 0.5 },
      }).ops,
    ).toMatchObject([
      {
        kind: 'clip.setTransform',
        after: { scale: 1.25, rotation: 15, opacity: 0.5 },
      },
    ]);
  });

  it('rejects invalid edit intents before producing ops', () => {
    expect(() =>
      buildCutClipOps(timelineFixture(), {
        clipId: 'clip-video',
        atFrame: 0,
      }),
    ).toThrow('Split frame must be inside clip bounds');

    const locked = timelineFixture();
    locked.tracks[0] = { ...locked.tracks[0]!, locked: true };
    expect(() =>
      buildMoveClipOps(locked, {
        clipId: 'clip-video',
        toFrame: 10,
      }),
    ).toThrow('Track is locked');

    expect(() =>
      buildTrimClipOps(timelineFixture(), {
        clipId: 'clip-video',
        edge: 'right',
        deltaFrames: 300,
      }),
    ).toThrow('Trim would remove the entire clip');

    expect(() =>
      buildCloseGapOps(twoClipTimelineFixture(), {
        trackId: 'track-video',
        gapStartFrame: 250,
        gapEndFrame: 320,
      }),
    ).toThrow('Cannot close a range that overlaps a clip');

    expect(() =>
      buildFlipClipOps(timelineFixture(), {
        clipIds: ['clip-video'],
      }),
    ).toThrow('At least one flip axis is required');
  });

  it('builds audio clip gain, mute, and fade ops', () => {
    const timeline = linkedTimelineFixture();
    const gain = buildSetAudioClipGainOps(timeline, {
      clipIds: ['clip-audio'],
      gainDb: 6,
    });
    expect(gain.ops).toEqual([
      {
        kind: 'clip.setAudio',
        clipId: 'clip-audio',
        before: { gainDb: null },
        after: { gainDb: 6 },
      },
    ]);

    const mute = buildSetAudioClipMuteOps(timeline, {
      clipIds: ['clip-audio'],
      muted: true,
    });
    expect(mute.ops).toEqual([
      {
        kind: 'clip.setAudio',
        clipId: 'clip-audio',
        before: { muted: null },
        after: { muted: true },
      },
    ]);

    const fades = buildSetAudioClipFadeOps(timeline, {
      clipIds: ['clip-audio'],
      edge: 'both',
      durationMs: 45_000,
      curve: 'equal-power',
    });
    expect(fades.ops).toEqual([
      {
        kind: 'clip.setAudio',
        clipId: 'clip-audio',
        before: {
          fadeInMs: null,
          fadeOutMs: null,
          fadeInCurve: null,
          fadeOutCurve: null,
        },
        after: {
          fadeInMs: 30_000,
          fadeOutMs: 30_000,
          fadeInCurve: 'equal-power',
          fadeOutCurve: 'equal-power',
        },
      },
    ]);

    const applied = applyTimelineOps(timeline, [
      ...gain.ops,
      ...mute.ops,
      ...fades.ops,
    ]);
    const restored = applyTimelineOps(applied.timeline, applied.inverses);

    expect(restored.timeline).toEqual(timeline);
    expect(fades.metadata.inspectClipIds).toEqual(['clip-audio']);
  });

  it('builds audio track volume, mute, and duck metadata ops', () => {
    const timeline = linkedTimelineFixture();

    expect(
      buildSetAudioTrackVolumeOps(timeline, {
        trackIds: ['track-audio'],
        volumeDb: -8,
      }).ops,
    ).toEqual([
      {
        kind: 'track.update',
        trackId: 'track-audio',
        before: { volumeDb: null },
        after: { volumeDb: -8 },
      },
    ]);

    expect(
      buildSetAudioTrackMuteOps(timeline, {
        trackIds: ['track-audio'],
        muted: true,
      }).ops,
    ).toEqual([
      {
        kind: 'track.update',
        trackId: 'track-audio',
        before: { muted: false },
        after: { muted: true },
      },
    ]);

    const duck = buildDuckAudioOps(timeline, {
      trackId: 'track-audio',
      duckUnderTrackId: 'track-video',
      volumeDb: -12,
    });
    expect(duck.ops).toEqual([
      {
        kind: 'track.update',
        trackId: 'track-audio',
        before: { duckUnderTrackId: null, volumeDb: null },
        after: { duckUnderTrackId: 'track-video', volumeDb: -12 },
      },
    ]);
    expect(duck.metadata.affectedTrackIds).toEqual(['track-audio']);
  });

  it('builds clamped audio crossfade ops for adjacent clips', () => {
    const timeline = audioTwoClipTimelineFixture();
    const transition = buildSetAudioTransitionOps(timeline, {
      clipId: 'clip-audio',
      transition: {
        kind: 'crossfade',
        durationMs: 60_000,
      },
    });

    expect(transition.ops).toEqual([
      {
        kind: 'clip.setAudioTransition',
        clipId: 'clip-audio',
        before: null,
        after: {
          kind: 'crossfade',
          durationMs: 20_000,
          curve: 'equal-power',
        },
      },
    ]);

    const crossfade = buildCrossfadeAudioClipsOps(timeline, {
      fromClipId: 'clip-audio',
      toClipId: 'clip-audio-b',
      durationMs: 1_500,
      curve: 'ease-in-out',
    });
    expect(crossfade.ops[0]).toMatchObject({
      kind: 'clip.setAudioTransition',
      clipId: 'clip-audio',
      after: {
        kind: 'crossfade',
        durationMs: 1_500,
        curve: 'ease-in-out',
      },
    });
  });

  it('builds audio volume keyframe and source replacement ops', () => {
    const timeline = linkedTimelineFixture();

    const keyframes = buildSetAudioVolumeKeyframesOps(timeline, {
      clipId: 'clip-audio',
      mode: 'replace',
      keys: [
        { atMs: 0, value: -12 },
        { atMs: 500, value: -6, interp: 'smooth' },
      ],
    });
    expect(keyframes.ops).toEqual([
      {
        kind: 'keyframe.setTrack',
        clipId: 'clip-audio',
        property: 'volumeDb',
        before: null,
        after: {
          property: 'volumeDb',
          keys: [
            { atMs: 0, value: -12 },
            { atMs: 500, value: -6, interp: 'smooth' },
          ],
        },
      },
    ]);

    const replacement = buildReplaceAudioClipSourceOps(timeline, {
      clipId: 'clip-audio',
      sourceRef: { kind: 'asset', assetId: 'asset-replacement' },
      sourceDurationMs: 45_000,
      name: 'Replacement',
    });
    expect(replacement.ops).toMatchObject([
      {
        kind: 'clip.remove',
        clipId: 'clip-audio',
      },
      {
        kind: 'clip.insert',
        trackId: 'track-audio',
        at: 0,
        clip: {
          id: 'clip-audio',
          name: 'Replacement',
          sourceRef: { kind: 'asset', assetId: 'asset-replacement' },
          durationMs: 30_000,
          trimStartMs: 0,
          trimEndMs: 30_000,
          sourceDurationMs: 45_000,
        },
      },
    ]);

    const applied = applyTimelineOps(timeline, replacement.ops);
    const restored = applyTimelineOps(applied.timeline, applied.inverses);

    expect(restored.timeline).toEqual(timeline);
  });

  it('rejects invalid audio edit intents before producing ops', () => {
    expect(() =>
      buildSetAudioClipGainOps(timelineFixture(), {
        clipIds: ['clip-video'],
        gainDb: 3,
      }),
    ).toThrow('Audio edits require audio clips');

    expect(() =>
      buildSetAudioClipGainOps(linkedTimelineFixture(), {
        clipIds: ['clip-audio'],
        gainDb: 30,
      }),
    ).toThrow('volumeDb keyframe value must be between -96 and 24');

    const locked = linkedTimelineFixture();
    locked.tracks[1] = { ...locked.tracks[1]!, locked: true };
    expect(() =>
      buildSetAudioTrackVolumeOps(locked, {
        trackIds: ['track-audio'],
        volumeDb: -6,
      }),
    ).toThrow('Track is locked');

    expect(() =>
      buildCrossfadeAudioClipsOps(linkedTimelineFixture(), {
        fromClipId: 'clip-audio',
        toClipId: 'missing',
        durationMs: 100,
      }),
    ).toThrow('Clip not found');
  });
});

function timelineFixture(clip: Partial<VisualTimelineClip> = {}): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 30_000,
    fps: 10,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips: [
          {
            id: 'clip-video',
            kind: 'video',
            name: 'Clip',
            sourceRef: { kind: 'asset', assetId: 'asset-video' },
            startMs: 0,
            durationMs: 30_000,
            trimStartMs: 0,
            trimEndMs: 30_000,
            sourceDurationMs: 60_000,
            ...clip,
          },
        ],
      },
    ],
  };
}

function twoClipTimelineFixture(): Timeline {
  const timeline = timelineFixture();
  const track = timeline.tracks[0]!;
  if (track.kind !== 'video') throw new Error('Expected video track');
  timeline.durationMs = 80_000;
  track.clips.push({
    ...track.clips[0]!,
    id: 'clip-b',
    startMs: 35_000,
  });
  return timeline;
}

function linkedTimelineFixture(): Timeline {
  const timeline = timelineFixture({
    playback: { speed: 1.5, reverse: false },
    linkGroupId: 'link-original',
    keyframes: [
      {
        property: 'opacity',
        keys: [{ atMs: 500, value: 0.5 }],
      },
    ],
  });
  timeline.tracks.push({
    id: 'track-audio',
    kind: 'audio-vo',
    name: 'Voice',
    muted: false,
    locked: false,
    order: 10,
    clips: [
      {
        id: 'clip-audio',
        kind: 'audio',
        name: 'Audio',
        sourceRef: { kind: 'asset', assetId: 'asset-audio' },
        linkGroupId: 'link-original',
        startMs: 0,
        durationMs: 30_000,
        trimStartMs: 0,
        trimEndMs: 30_000,
        sourceDurationMs: 60_000,
      },
    ],
  });
  return timeline;
}

function audioTwoClipTimelineFixture(): Timeline {
  const timeline = linkedTimelineFixture();
  const track = timeline.tracks[1]!;
  if (track.kind !== 'audio-vo') throw new Error('Expected audio track');
  const first = track.clips[0] as AudioTimelineClip;
  track.clips.push({
    ...first,
    id: 'clip-audio-b',
    linkGroupId: undefined,
    startMs: 30_000,
    durationMs: 20_000,
    trimStartMs: 0,
    trimEndMs: 20_000,
    sourceDurationMs: 20_000,
  });
  timeline.durationMs = 50_000;
  return timeline;
}

function idFactory(...ids: string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    if (!id) throw new Error(`Missing test id at index ${index}`);
    index += 1;
    return id;
  };
}
