import { describe, expect, it } from 'vitest';

import {
  applyTimelineOp,
  applyTimelineOps,
  buildAddVividOverlayClipOps,
  buildApplyVividOverlayMotionTemplateOps,
  buildSetClipParamsOps,
  buildSetVividOverlayControlKeyframesOps,
  buildSetVividOverlayControlsOps,
  EditBuilderError,
  isVividOverlayClip,
  parseVividOverlayParams,
  TimelineOpError,
  TimelineOpSchema,
  TimelineSchema,
  VIVID_OVERLAY_EFFECT_TYPE,
  VIVID_OVERLAY_SOURCE_PREFIX,
  vividOverlayControlDefaults,
  vividOverlayControlKeyframeErrors,
  vividOverlayControlErrors,
  vividOverlaySourceRef,
  type Timeline,
  type VividOverlayControlDef,
} from '../src';

function overlayTimelineFixture(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 4000,
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
            sourceRef: { kind: 'asset', assetId: 'asset-a' },
            startMs: 0,
            durationMs: 4000,
            trimStartMs: 0,
            trimEndMs: 4000,
          },
        ],
      },
      {
        id: 'track-overlay',
        kind: 'overlay',
        name: 'Overlay',
        muted: false,
        locked: false,
        order: 1,
        clips: [],
      },
    ],
  };
}

describe('vivid overlay IR activation', () => {
  it('builds an effect clip insert on an overlay track and applies it', () => {
    const timeline = overlayTimelineFixture();
    const result = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 500,
        durationMs: 2000,
        controls: { text: 'NEW!', color: '#ff3366' },
      },
      { idFactory: () => 'overlay-clip-1' },
    );

    expect(result.ops).toHaveLength(1);
    const applied = applyTimelineOp(timeline, result.ops[0]!);
    const overlayTrack = applied.timeline.tracks.find(
      (track) => track.id === 'track-overlay',
    )!;
    expect(overlayTrack.clips).toHaveLength(1);
    const clip = overlayTrack.clips[0]!;
    expect(clip.kind).toBe('effect');
    expect(isVividOverlayClip(clip)).toBe(true);
    if (clip.kind !== 'effect') throw new Error('expected effect clip');
    expect(clip.effectType).toBe(VIVID_OVERLAY_EFFECT_TYPE);
    expect(clip.sourceRef).toEqual(
      vividOverlaySourceRef('html.marker-highlight'),
    );
    expect(parseVividOverlayParams(clip.params)).toMatchObject({
      presetId: 'html.marker-highlight',
      backend: 'html',
      controls: { text: 'NEW!', color: '#ff3366' },
    });

    // undo restores the empty overlay track
    if (applied.inverse.kind === 'timeline.batch') {
      throw new Error('expected a single inverse op for clip.insert');
    }
    const undone = applyTimelineOp(applied.timeline, applied.inverse);
    expect(
      undone.timeline.tracks.find((track) => track.id === 'track-overlay')!
        .clips,
    ).toHaveLength(0);
  });

  it('rejects vivid overlay inserts on non-overlay tracks', () => {
    const timeline = overlayTimelineFixture();
    expect(() =>
      buildAddVividOverlayClipOps(timeline, {
        trackId: 'track-video',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 1000,
      }),
    ).toThrow(EditBuilderError);
  });

  it('round-trips a timeline containing a vivid overlay under timeline.v1', () => {
    const timeline = overlayTimelineFixture();
    const result = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.lower-third',
        backend: 'html',
        startMs: 0,
        durationMs: 1500,
        loop: 'hold',
      },
      { idFactory: () => 'overlay-clip-2' },
    );
    const applied = applyTimelineOp(timeline, result.ops[0]!);

    const serialized = JSON.parse(JSON.stringify(applied.timeline));
    const parsed = TimelineSchema.parse(serialized);
    expect(parsed).toEqual(serialized);
    const overlayTrack = parsed.tracks.find(
      (track: { id: string }) => track.id === 'track-overlay',
    )!;
    expect(overlayTrack.clips[0]!.kind).toBe('effect');
  });

  it('keeps legacy timelines (no effect clips) valid — v1 compat', () => {
    const legacy = JSON.parse(JSON.stringify(overlayTimelineFixture()));
    expect(() => TimelineSchema.parse(legacy)).not.toThrow();
  });

  it('rejects effect clips on video tracks at the ops layer (schema stays permissive)', () => {
    // Schema-level: parse tolerates effect clips on any visual track so the
    // v1 document format stays additive; placement policy lives in the ops
    // layer, which refuses to insert them anywhere but overlay tracks.
    const timeline = overlayTimelineFixture();
    const clip = {
      id: 'bad-effect',
      kind: 'effect' as const,
      effectType: VIVID_OVERLAY_EFFECT_TYPE,
      sourceRef: vividOverlaySourceRef('x'),
      startMs: 0,
      durationMs: 100,
      trimStartMs: 0,
      trimEndMs: 100,
    };
    expect(() =>
      applyTimelineOp(timeline, {
        kind: 'clip.insert',
        trackId: 'track-video',
        clip,
        at: 0,
      }),
    ).toThrow(/cannot be placed/);
  });

  it('accepts transforms on effect clips at the schema level', () => {
    const timeline = JSON.parse(JSON.stringify(overlayTimelineFixture()));
    timeline.tracks[1].clips.push({
      id: 'fx-1',
      kind: 'effect',
      effectType: VIVID_OVERLAY_EFFECT_TYPE,
      sourceRef: { kind: 'asset', assetId: `${VIVID_OVERLAY_SOURCE_PREFIX}p` },
      startMs: 0,
      durationMs: 100,
      trimStartMs: 0,
      trimEndMs: 100,
      transforms: { positionX: 0.1, positionY: -0.2, scale: 0.5, opacity: 0.9 },
    });
    expect(() => TimelineSchema.parse(timeline)).not.toThrow();
  });

  it('sets overlay controls via clip.setParams with an invertible op', () => {
    const timeline = overlayTimelineFixture();
    const inserted = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 2000,
        controls: { text: 'Hi', color: '#ffd166' },
      },
      { idFactory: () => 'overlay-clip-3' },
    );
    const withClip = applyTimelineOp(timeline, inserted.ops[0]!).timeline;

    const result = buildSetVividOverlayControlsOps(withClip, {
      clipId: 'overlay-clip-3',
      controls: { color: '#008000' },
      loop: 'loop',
    });
    expect(result.ops).toEqual([
      {
        kind: 'clip.setParams',
        clipId: 'overlay-clip-3',
        before: {
          presetId: 'html.marker-highlight',
          backend: 'html',
          controls: { text: 'Hi', color: '#ffd166' },
        },
        after: {
          presetId: 'html.marker-highlight',
          backend: 'html',
          controls: { text: 'Hi', color: '#008000' },
          loop: 'loop',
        },
      },
    ]);
    // schema accepts the op
    expect(() => TimelineOpSchema.parse(result.ops[0])).not.toThrow();

    const applied = applyTimelineOp(withClip, result.ops[0]!);
    const clip = applied.timeline.tracks[1]!.clips[0]!;
    expect(parseVividOverlayParams(clip.params)?.controls.color).toBe(
      '#008000',
    );

    // inverse restores the previous controls
    if (applied.inverse.kind === 'timeline.batch') {
      throw new Error('expected a single inverse op');
    }
    const undone = applyTimelineOp(applied.timeline, applied.inverse);
    const restored = undone.timeline.tracks[1]!.clips[0]!;
    expect(parseVividOverlayParams(restored.params)?.controls.color).toBe(
      '#ffd166',
    );
    expect(parseVividOverlayParams(restored.params)?.loop).toBeUndefined();
  });

  it('rejects invalid control values when defs are provided', () => {
    const timeline = overlayTimelineFixture();
    const inserted = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 2000,
      },
      { idFactory: () => 'overlay-clip-4' },
    );
    const withClip = applyTimelineOp(timeline, inserted.ops[0]!).timeline;
    const defs: VividOverlayControlDef[] = [
      {
        id: 'fontSize',
        type: 'number',
        labelKey: 'overlays.controls.fontSize',
        defaultValue: 64,
        min: 24,
        max: 160,
      },
    ];
    expect(() =>
      buildSetVividOverlayControlsOps(withClip, {
        clipId: 'overlay-clip-4',
        controls: { fontSize: 9999 },
        controlDefs: defs,
      }),
    ).toThrow(/above max 160/);
    expect(() =>
      buildSetVividOverlayControlsOps(withClip, {
        clipId: 'overlay-clip-4',
        controls: { mystery: true },
        controlDefs: defs,
      }),
    ).toThrow(/Unknown control: mystery/);
  });

  it('rejects overlay control edits on non-overlay clips', () => {
    const timeline = overlayTimelineFixture();
    expect(() =>
      buildSetVividOverlayControlsOps(timeline, {
        clipId: 'clip-video',
        controls: { color: '#008000' },
      }),
    ).toThrow(EditBuilderError);
  });

  it('sets and clears numeric overlay control keyframes with invertible params ops', () => {
    const timeline = overlayTimelineFixture();
    const inserted = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 2000,
        controls: { fontSize: 64 },
      },
      { idFactory: () => 'overlay-clip-keyframes' },
    );
    const withClip = applyTimelineOp(timeline, inserted.ops[0]!).timeline;
    const defs: VividOverlayControlDef[] = [
      {
        id: 'fontSize',
        type: 'number',
        labelKey: 'overlays.controls.fontSize',
        defaultValue: 64,
        min: 24,
        max: 160,
      },
    ];

    const result = buildSetVividOverlayControlKeyframesOps(withClip, {
      clipId: 'overlay-clip-keyframes',
      controlId: 'fontSize',
      keys: [
        { atMs: 0, value: 48, interp: 'linear' },
        { atMs: 1000, value: 96, interp: 'smooth' },
      ],
      controlDefs: defs,
    });

    expect(result.ops).toEqual([
      {
        kind: 'clip.setParams',
        clipId: 'overlay-clip-keyframes',
        before: {
          presetId: 'html.marker-highlight',
          backend: 'html',
          controls: { fontSize: 64 },
        },
        after: {
          presetId: 'html.marker-highlight',
          backend: 'html',
          controls: { fontSize: 64 },
          controlKeyframes: [
            {
              controlId: 'fontSize',
              keys: [
                { atMs: 0, value: 48, interp: 'linear' },
                { atMs: 1000, value: 96, interp: 'smooth' },
              ],
            },
          ],
        },
      },
    ]);
    expect(() => TimelineOpSchema.parse(result.ops[0])).not.toThrow();

    const applied = applyTimelineOp(withClip, result.ops[0]!);
    const clip = applied.timeline.tracks[1]!.clips[0]!;
    expect(parseVividOverlayParams(clip.params)?.controlKeyframes).toEqual([
      {
        controlId: 'fontSize',
        keys: [
          { atMs: 0, value: 48, interp: 'linear' },
          { atMs: 1000, value: 96, interp: 'smooth' },
        ],
      },
    ]);

    const cleared = buildSetVividOverlayControlKeyframesOps(applied.timeline, {
      clipId: 'overlay-clip-keyframes',
      controlId: 'fontSize',
      keys: [],
      controlDefs: defs,
    });
    expect(
      parseVividOverlayParams(
        (cleared.ops[0] as { after: Record<string, unknown> }).after,
      )?.controlKeyframes,
    ).toBeUndefined();
  });

  it('validates overlay control keyframes against numeric control definitions', () => {
    const defs: VividOverlayControlDef[] = [
      {
        id: 'size',
        type: 'number',
        labelKey: 'overlays.controls.size',
        defaultValue: 48,
        min: 8,
        max: 128,
      },
      {
        id: 'text',
        type: 'text',
        labelKey: 'overlays.controls.text',
        defaultValue: 'Hello',
      },
      {
        id: 'color',
        type: 'color',
        labelKey: 'overlays.controls.color',
        defaultValue: '#ffffff',
      },
      {
        id: 'style',
        type: 'select',
        labelKey: 'overlays.controls.style',
        defaultValue: 'bold',
        options: ['bold', 'outline'],
      },
      {
        id: 'enabled',
        type: 'toggle',
        labelKey: 'overlays.controls.enabled',
        defaultValue: true,
      },
    ];

    expect(
      vividOverlayControlKeyframeErrors(
        [{ controlId: 'size', keys: [{ atMs: 0, value: 48 }] }],
        defs,
        1000,
      ),
    ).toEqual([]);
    expect(
      vividOverlayControlKeyframeErrors(
        [
          { controlId: 'text', keys: [{ atMs: 0, value: 1 }] },
          { controlId: 'color', keys: [{ atMs: 0, value: 1 }] },
          { controlId: 'style', keys: [{ atMs: 0, value: 1 }] },
          { controlId: 'enabled', keys: [{ atMs: 0, value: 1 }] },
          { controlId: 'size', keys: [{ atMs: 2000, value: 48 }] },
          { controlId: 'size', keys: [{ atMs: 0, value: 200 }] },
        ],
        defs,
        1000,
      ),
    ).toEqual([
      'Control text does not support keyframes',
      'Control color does not support keyframes',
      'Control style does not support keyframes',
      'Control enabled does not support keyframes',
      'Control size keyframe exceeds clip duration 1000',
      'Duplicate keyframe track: size',
    ]);
    expect(
      vividOverlayControlKeyframeErrors(
        [
          {
            controlId: 'size',
            keys: [
              { atMs: 500, value: 48 },
              { atMs: 100, value: 72 },
            ],
          },
        ],
        defs,
        1000,
      ),
    ).toEqual(['Control size keyframes must be sorted and unique']);
    expect(
      vividOverlayControlKeyframeErrors(
        [{ controlId: 'size', keys: [{ atMs: 2000, value: 200 }] }],
        defs,
        1000,
      ),
    ).toEqual([
      'Control size keyframe exceeds clip duration 1000',
      'Control size keyframe above max 128',
    ]);
  });

  it('applies overlay motion templates as keyframes plus params provenance', () => {
    const timeline = overlayTimelineFixture();
    const inserted = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 2000,
      },
      { idFactory: () => 'overlay-clip-motion' },
    );
    const withClip = applyTimelineOp(timeline, inserted.ops[0]!).timeline;

    const result = buildApplyVividOverlayMotionTemplateOps(withClip, {
      clipId: 'overlay-clip-motion',
      templateId: 'entrance.fade-up',
      strength: 'subtle',
      category: 'callout',
      appliedAt: '2026-07-08T00:00:00.000Z',
    });

    expect(result.ops.map((op) => op.kind)).toEqual([
      'keyframe.setTrack',
      'keyframe.setTrack',
      'clip.setParams',
    ]);
    expect(result.ops[0]).toMatchObject({
      kind: 'keyframe.setTrack',
      clipId: 'overlay-clip-motion',
      property: 'opacity',
      before: null,
    });
    expect(result.ops[1]).toMatchObject({
      kind: 'keyframe.setTrack',
      clipId: 'overlay-clip-motion',
      property: 'positionY',
      before: null,
    });
    expect(result.ops[2]).toMatchObject({
      kind: 'clip.setParams',
      clipId: 'overlay-clip-motion',
      after: {
        motionTemplate: {
          source: 'motion-template',
          templateId: 'entrance.fade-up',
          strength: 'subtle',
          appliedAt: '2026-07-08T00:00:00.000Z',
          affectedProperties: ['opacity', 'positionY'],
        },
      },
    });

    const applied = applyTimelineOps(withClip, result.ops).timeline;
    const clip = applied.tracks[1]!.clips[0]!;
    expect(clip.keyframes?.map((track) => track.property)).toEqual([
      'opacity',
      'positionY',
    ]);
    expect(parseVividOverlayParams(clip.params)?.motionTemplate).toMatchObject({
      templateId: 'entrance.fade-up',
      strength: 'subtle',
      affectedProperties: ['opacity', 'positionY'],
    });
  });

  it('replaces only affected keyframe tracks when applying a motion template', () => {
    const timeline = overlayTimelineFixture();
    const inserted = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 2000,
      },
      { idFactory: () => 'overlay-clip-overwrite' },
    );
    const withClip = applyTimelineOp(timeline, inserted.ops[0]!).timeline;
    const overlayTrack = withClip.tracks[1]!;
    if (overlayTrack.kind !== 'overlay') {
      throw new Error('expected the overlay track at index 1');
    }
    const seeded: Timeline = {
      ...withClip,
      tracks: [
        withClip.tracks[0]!,
        {
          ...overlayTrack,
          clips: [
            {
              ...overlayTrack.clips[0]!,
              keyframes: [
                {
                  property: 'opacity' as const,
                  keys: [{ atMs: 0, value: 0.5 }],
                },
                {
                  property: 'rotation' as const,
                  keys: [{ atMs: 0, value: 12 }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = buildApplyVividOverlayMotionTemplateOps(seeded, {
      clipId: 'overlay-clip-overwrite',
      templateId: 'attention.ping',
      strength: 'normal',
      category: 'callout',
      appliedAt: '2026-07-08T00:00:00.000Z',
    });
    const opacityOp = result.ops.find(
      (op) => op.kind === 'keyframe.setTrack' && op.property === 'opacity',
    );
    expect(opacityOp).toMatchObject({
      before: { property: 'opacity', keys: [{ atMs: 0, value: 0.5 }] },
    });

    const applied = applyTimelineOps(seeded, result.ops).timeline;
    const clip = applied.tracks[1]!.clips[0]!;
    expect(clip.keyframes?.some((track) => track.property === 'rotation')).toBe(
      true,
    );
    expect(
      clip.keyframes?.find((track) => track.property === 'opacity')?.keys,
    ).not.toEqual([{ atMs: 0, value: 0.5 }]);
  });

  it('rejects incompatible overlay motion template categories', () => {
    const timeline = overlayTimelineFixture();
    const inserted = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 2000,
      },
      { idFactory: () => 'overlay-clip-incompatible' },
    );
    const withClip = applyTimelineOp(timeline, inserted.ops[0]!).timeline;
    expect(() =>
      buildApplyVividOverlayMotionTemplateOps(withClip, {
        clipId: 'overlay-clip-incompatible',
        templateId: 'ambient.float',
        category: 'callout',
      }),
    ).toThrow(/not compatible/);
  });

  it('refuses clip.setParams payloads that would brick a vivid overlay', () => {
    const timeline = overlayTimelineFixture();
    const inserted = buildAddVividOverlayClipOps(
      timeline,
      {
        trackId: 'track-overlay',
        presetId: 'html.marker-highlight',
        backend: 'html',
        startMs: 0,
        durationMs: 2000,
      },
      { idFactory: () => 'overlay-clip-5' },
    );
    const withClip = applyTimelineOp(timeline, inserted.ops[0]!).timeline;
    expect(() =>
      applyTimelineOp(withClip, {
        kind: 'clip.setParams',
        clipId: 'overlay-clip-5',
        before: null,
        after: null,
      }),
    ).toThrow(TimelineOpError);
    expect(() =>
      applyTimelineOp(withClip, {
        kind: 'clip.setParams',
        clipId: 'overlay-clip-5',
        before: null,
        after: { presetId: '', backend: 'nope' },
      }),
    ).toThrow(/Invalid vivid overlay params/);
    // builder-level guard: deleting a required key is rejected before an op exists
    expect(() =>
      buildSetClipParamsOps(withClip, {
        clipId: 'overlay-clip-5',
        patch: { presetId: null },
      }),
    ).toThrow(/not a valid vivid overlay payload/);
  });

  it('validates params and control values', () => {
    expect(parseVividOverlayParams(null)).toBeNull();
    expect(
      parseVividOverlayParams({ presetId: '', backend: 'html' }),
    ).toBeNull();
    expect(
      parseVividOverlayParams({
        presetId: 'p',
        backend: 'nope',
        controls: {},
      }),
    ).toBeNull();

    const defs: VividOverlayControlDef[] = [
      {
        id: 'text',
        type: 'text',
        labelKey: 'overlays.controls.text',
        defaultValue: 'Hello',
      },
      {
        id: 'size',
        type: 'number',
        labelKey: 'overlays.controls.size',
        defaultValue: 48,
        min: 8,
        max: 128,
      },
      {
        id: 'style',
        type: 'select',
        labelKey: 'overlays.controls.style',
        defaultValue: 'bold',
        options: ['bold', 'outline'],
      },
    ];
    expect(vividOverlayControlDefaults(defs)).toEqual({
      text: 'Hello',
      size: 48,
      style: 'bold',
    });
    expect(vividOverlayControlErrors({ text: 'Hi', size: 64 }, defs)).toEqual(
      [],
    );
    expect(
      vividOverlayControlErrors(
        { unknown: 1, size: 999, style: 'neon', text: 5 },
        defs,
      ),
    ).toEqual([
      'Unknown control: unknown',
      'Control size above max 128',
      'Control style has unknown option: neon',
      'Control text expects string, got number',
    ]);
  });
});
