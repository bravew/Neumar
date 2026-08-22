import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyTimelineOp,
  applyTimelineOps,
  ClipEffectStackSchema,
  createClipEffect,
  resolveClipEffectParameter,
  TimelineOpError,
  TimelineOpSchema,
  TimelineSchema,
  type ClipEffectStack,
  type Timeline,
} from '../src/index.js';

const EFFECT_ID = '15ef4de3-a29d-4435-aa78-70e0948e5191';

afterEach(() => vi.restoreAllMocks());

describe('clip effects', () => {
  it('creates a stable versioned effect with a random UUID', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(EFFECT_ID);

    expect(createClipEffect('white-balance')).toEqual({
      id: EFFECT_ID,
      version: 1,
      kind: 'white-balance',
      params: { temperature: 0, tint: 0 },
    });
  });

  it('rejects unknown params, out-of-range values, and duplicate ids', () => {
    expect(
      ClipEffectStackSchema.safeParse({
        schema: 'neuma.video.clip-effects.v1',
        effects: [
          brightness({ amount: 2 }),
          { ...brightness({ amount: 0 }), params: { amount: 0, extra: 1 } },
          brightness({ amount: 0 }),
        ],
      }).success,
    ).toBe(false);
    expect(
      ClipEffectStackSchema.safeParse({
        schema: 'neuma.video.clip-effects.v1',
        effects: [brightness({ amount: 0 }), brightness({ amount: 0.1 })],
      }).success,
    ).toBe(false);
  });

  it('rejects keyframes targeting missing effects and invalid parameters', () => {
    const missingTarget = stack({
      keyframes: [
        {
          effectId: 'ba5946d3-0a19-41d9-b721-3ae8f0d3a01c',
          parameter: 'amount',
          keys: [{ atMs: 0, value: 0 }],
        },
      ],
    });
    expect(ClipEffectStackSchema.safeParse(missingTarget).success).toBe(false);

    const invalidParameter = stack({
      keyframes: [
        {
          effectId: EFFECT_ID,
          parameter: 'radius',
          keys: [{ atMs: 0, value: 10 }],
        },
      ],
    });
    expect(ClipEffectStackSchema.safeParse(invalidParameter).success).toBe(
      false,
    );
  });

  it('sets an effect stack with an inverse and preserves legacy filters', () => {
    const timeline = timelineFixture();
    const effectStack = stack();
    const result = applyTimelineOp(timeline, {
      kind: 'clip.setEffects',
      clipId: 'clip-video',
      before: null,
      after: effectStack,
    });
    const clip = result.timeline.tracks[0]!.clips[0]!;

    expect(clip).toMatchObject({
      filters: { sepia: 0.25 },
      effects: effectStack,
    });
    expect(
      applyTimelineOps(result.timeline, [result.inverse]).timeline,
    ).toEqual(timeline);
  });

  it('upserts, resolves, removes, and restores effect parameter keyframes', () => {
    const seeded = applyTimelineOp(timelineFixture(), {
      kind: 'clip.setEffects',
      clipId: 'clip-video',
      before: null,
      after: stack(),
    }).timeline;
    const inserted = applyTimelineOp(seeded, {
      kind: 'effectKeyframe.upsert',
      clipId: 'clip-video',
      effectId: EFFECT_ID,
      parameter: 'amount',
      key: { atMs: 500, value: 0.5 },
    });
    const clip = inserted.timeline.tracks[0]!.clips[0]!;
    if (clip.kind !== 'video' || !clip.effects)
      throw new Error('Expected video');

    expect(
      resolveClipEffectParameter(
        clip.effects,
        clip.effects.effects[0]!,
        'amount',
        500,
      ),
    ).toBe(0.5);
    expect(
      applyTimelineOps(inserted.timeline, [inserted.inverse]).timeline,
    ).toEqual(seeded);
  });

  it('rejects an out-of-range effect keyframe at the op boundary', () => {
    const seeded = applyTimelineOp(timelineFixture(), {
      kind: 'clip.setEffects',
      clipId: 'clip-video',
      before: null,
      after: stack(),
    }).timeline;

    expect(() =>
      applyTimelineOp(seeded, {
        kind: 'effectKeyframe.upsert',
        clipId: 'clip-video',
        effectId: EFFECT_ID,
        parameter: 'amount',
        key: { atMs: 500, value: 2 },
      }),
    ).toThrow(TimelineOpError);
  });

  it('sets and removes effect tracks with exact inverses', () => {
    const seeded = applyTimelineOp(timelineFixture(), {
      kind: 'clip.setEffects',
      clipId: 'clip-video',
      before: null,
      after: stack(),
    }).timeline;
    const setTrack = applyTimelineOp(seeded, {
      kind: 'effectKeyframe.setTrack',
      clipId: 'clip-video',
      effectId: EFFECT_ID,
      parameter: 'amount',
      before: null,
      after: {
        effectId: EFFECT_ID,
        parameter: 'amount',
        keys: [
          { atMs: 0, value: -0.1 },
          { atMs: 1000, value: 0.2 },
        ],
      },
    });
    expect(
      applyTimelineOps(setTrack.timeline, [setTrack.inverse]).timeline,
    ).toEqual(seeded);

    const removed = applyTimelineOp(setTrack.timeline, {
      kind: 'effectKeyframe.remove',
      clipId: 'clip-video',
      effectId: EFFECT_ID,
      parameter: 'amount',
      atMs: 1000,
      snapshot: { atMs: 1000, value: 0.2 },
    });
    expect(
      applyTimelineOps(removed.timeline, [removed.inverse]).timeline,
    ).toEqual(setTrack.timeline);
  });

  it('parses the new operations and validates effects in saved timelines', () => {
    expect(
      TimelineOpSchema.safeParse({
        kind: 'clip.setEffects',
        clipId: 'clip-video',
        before: null,
        after: stack(),
      }).success,
    ).toBe(true);
    const timeline = timelineFixture();
    const clip = timeline.tracks[0]!.clips[0]!;
    if (clip.kind !== 'video') throw new Error('Expected video');
    timeline.tracks[0]!.clips[0] = { ...clip, effects: stack() };
    expect(TimelineSchema.safeParse(timeline).success).toBe(true);
  });
});

function brightness(params: { amount: number }) {
  return {
    version: 1 as const,
    id: EFFECT_ID,
    kind: 'brightness' as const,
    params,
  };
}

function stack(overrides: Partial<ClipEffectStack> = {}): ClipEffectStack {
  return {
    schema: 'neuma.video.clip-effects.v1',
    effects: [brightness({ amount: 0 })],
    ...overrides,
  };
}

function timelineFixture(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 2000,
    fps: 30,
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
            id: 'clip-video',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-video' },
            startMs: 0,
            durationMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
            filters: { sepia: 0.25 },
          },
        ],
      },
    ],
  };
}
