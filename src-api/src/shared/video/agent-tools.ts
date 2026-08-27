import { randomUUID } from 'node:crypto';

import {
  isVividOverlayClip,
  KeyframeSchema,
  KeyframeablePropertySchema,
  type KeyframeTrack,
  parseVividOverlayParams,
  TimelineOpSchema,
  TRANSITION_EASINGS,
  VIVID_OVERLAY_MOTION_TEMPLATE_IDS,
  VIVID_OVERLAY_MOTION_TEMPLATE_STRENGTHS,
  type TimelineOp,
  type VividOverlayControlDef,
  type VividOverlayPresetDef,
} from '@neumar/video-ir';
import { z } from 'zod';

import { retimeTimelineCaptions } from './caption-retime';
import { normalizeCssColor } from './css-colors';
import { calculateWer } from './eval';
import { findVividOverlayPreset } from './overlays/registry';
import { buildRenderPlan } from './render-plan';
import {
  compileTimelineToEdl,
  insertCaptureCaptionClips,
  pictureTimelineDurationMs,
  rebuildTimelineFromStoryboard,
} from './timeline';
import {
  applyProjectTimelineOp as applyTimelineOpToProject,
  applyProjectTimelineOps as applyTimelineOpsToProject,
  buildApplyVividOverlayMotionTemplateOps,
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
  buildSetClipParamsOps,
  buildSetClipSpeedOps,
  buildSetClipTransformOps,
  buildSetVividOverlayControlKeyframesOps,
  buildSetVividOverlayControlsOps,
  proposeProjectTimelineOps,
} from './timeline-ops';
import type { EditBuildMetadata, EditBuildResult } from './timeline-ops';
import {
  VIDEO_TRANSITION_KINDS,
  VIDEO_TRANSITION_REGISTRY,
  normalizeTransition,
} from './types';
import type {
  AgentJournalEntry,
  AspectRatio,
  AssetPlan,
  EditDecisionList,
  MediaItem,
  MusicPlan,
  ProjectDiffOperation,
  SourceMedia,
  Storyboard,
  StoryboardScene,
  SubtitleStyle,
  TimelineClip,
  TimelineTrack,
  TimelineTransition,
  VisualTimelineClip,
  TransitionDirection,
  TransitionKind,
  VideoProject,
  VideoTimeline,
} from './types';

const aspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:5']);
const transitionKindSchema = z.enum(
  VIDEO_TRANSITION_KINDS as [TransitionKind, ...TransitionKind[]],
);
const transitionDirectionSchema = z.enum([
  'from-left',
  'from-right',
  'from-top',
  'from-bottom',
] satisfies [TransitionDirection, ...TransitionDirection[]]);
const transitionParamValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);
const transitionTimingSchema = z
  .object({
    durationMs: z.number().int().min(33).max(3000).optional(),
    easing: z.enum(TRANSITION_EASINGS).optional(),
    holdPct: z.number().min(0).max(1).optional(),
  })
  .strict();
const transitionSchema = z
  .union([
    transitionKindSchema,
    z
      .object({
        kind: transitionKindSchema,
        durationMs: z.number().int().min(33).max(3000).optional(),
        direction: transitionDirectionSchema.optional(),
        timing: transitionTimingSchema.optional(),
        params: z.record(z.string(), transitionParamValueSchema).optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (typeof value === 'string' || !value.direction) return;
    const entry = VIDEO_TRANSITION_REGISTRY.find(
      (item) => item.kind === value.kind,
    );
    if (
      !entry ||
      !supportsTransitionDirection(entry.directions, value.direction)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Transition ${value.kind} does not support direction ${value.direction}`,
        path: ['direction'],
      });
    }
  });
const rectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict();
const assetPlanSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('existing'),
      assetId: z.string().min(1),
      trimMs: z
        .tuple([z.number().int().min(0), z.number().int().positive()])
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('image-pan'),
      assetId: z.string().min(1),
      kenBurns: z
        .object({ from: rectSchema, to: rectSchema })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ai-image'),
      prompt: z.string().min(1),
      refImageIds: z.array(z.string().min(1)).optional(),
      provider: z.string().min(1).optional(),
      aspectRatio: aspectRatioSchema.optional(),
      size: z.string().min(1).optional(),
      seed: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ai-clip'),
      prompt: z.string().min(1),
      refImageId: z.string().min(1).optional(),
      refImageTailId: z.string().min(1).optional(),
      provider: z.string().min(1).optional(),
      aspectRatio: aspectRatioSchema.optional(),
      durationMs: z.number().int().positive().optional(),
      seed: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('broll-search'),
      query: z.string().min(1),
      provider: z
        .enum(['pexels', 'pixabay', 'storyblocks', 'linked'])
        .optional(),
      pinnedHitId: z.string().min(1).optional(),
      sourceIds: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tts-narration'),
      text: z.string().min(1),
      voiceId: z.string().min(1).optional(),
      provider: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('lipsync'),
      text: z.string().min(1),
      voiceId: z.string().min(1).optional(),
      voiceProvider: z.string().min(1).optional(),
      referenceImageAssetId: z.string().min(1),
      lipsyncProvider: z.string().min(1).optional(),
      aspectRatio: aspectRatioSchema.optional(),
      motionScale: z.number().positive().optional(),
      background: z.unknown().optional(),
      egressConfirmed: z.boolean().optional(),
    })
    .strict(),
]);
export const videoStoryboardSchema = z
  .object({
    status: z.enum(['draft', 'approved', 'edited']),
    intent: z.string().min(1),
    totalDurationMs: z.number().int().min(0),
    costEstimateUsd: z
      .object({ low: z.number().min(0), high: z.number().min(0) })
      .strict(),
    scenes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            durationMs: z.number().int().positive(),
            intent: z.string().min(1),
            caption: z
              .object({
                text: z.string(),
                style: z.unknown().optional(),
              })
              .strict()
              .optional(),
            overlayCaptions: z.array(z.unknown()).optional(),
            transition: transitionSchema.optional(),
            muteAudio: z.boolean().optional(),
            reframe: z.unknown().optional(),
            assetPlan: assetPlanSchema,
            htmlFrameSeed: z.unknown().optional(),
          })
          .strict(),
      )
      .min(1),
    approvedAt: z.string().optional(),
    approvedBy: z.enum(['user', 'auto']).optional(),
    music: z.unknown().optional(),
    narration: z.unknown().optional(),
  })
  .strict();

function supportsTransitionDirection(
  directions: readonly string[],
  direction: TransitionDirection,
): boolean {
  return directions.some((item) => item === direction);
}
const audioSeamModeSchema = z.enum(['follow', 'cut']);
const timelineBookendPositionSchema = z.enum(['intro', 'outro']);
const providerKindsSchema = z.enum(['image', 'video', 'audio']);
const publishChannelSchema = z.enum(['slack', 'youtube', 'tiktok']);
const renderPresetSchema = z.enum(['draft', 'standard', 'high']);
const renderWhereSchema = z.enum(['local', 'cloud']);
const languageSchema = z.enum(['en', 'zh', 'es', 'fr', 'hi', 'pt']);
const timelineProposalApplyModeSchema = z.enum([
  'suggest',
  'auto',
  'review-each',
]);
const AUDIO_CUT_FADE_MS = 30;
const MIN_BOOKEND_FADE_MS = 33;
const MAX_BOOKEND_FADE_MS = 3000;
const FRAME_TOLERANCE_MS = 34;
const TRANSCRIPT_WER_THRESHOLD = 0.1;
const SOURCE_FOOTAGE_SCENE_RE =
  /\b(?:recording|source|footage|clip|clips|presenter|screen\s*capture|dashboard|scorecard|meeting|webinar|interview|walks?\s+through|reviewed|mentioned|discussed)\b/i;
const TITLE_CARD_SCENE_RE =
  /\b(?:title\s*card|opening\s*title|intro\s*card|end\s*card|slate)\b/i;

const subtitleStyleSchema = z
  .object({
    fontFamily: z.string().min(1).optional(),
    fontSize: z.number().int().min(8).max(128).optional(),
    color: z.string().min(1).optional(),
    background: z.string().min(1).optional(),
    position: z.enum(['top', 'middle', 'bottom']).optional(),
    animation: z
      .enum(['none', 'tiktok-word', 'hormozi-bold', 'classic', 'karaoke'])
      .optional(),
  })
  .strict();
const previewRangeSchema = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.endMs > range.startMs, {
    message: 'Preview range end must be after start',
    path: ['endMs'],
  });
export const editLinkPolicySchema = z.enum(['linked', 'primary-only']);
export const cutRetainSchema = z.enum(['both', 'left', 'right']);
export const clipPlaybackTimingPolicySchema = z.enum([
  'preserve-source-span',
  'preserve-timeline-duration',
]);
export const clipInterpolationQualitySchema = z.enum(['low', 'medium', 'high']);
export const duplicatePlacementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('after-originals') }).strict(),
  z
    .object({
      kind: z.literal('at-frame'),
      startFrame: z.number().int().min(0),
      trackId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('offset-frames'),
      deltaFrames: z.number().int(),
    })
    .strict(),
]);
export const clipTransformSchema = z
  .object({
    scale: z.number().positive().optional(),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotation: z.number().optional(),
    fit: z.enum(['cover', 'contain', 'fill', 'blur-pad']).optional(),
    background: z.string().min(1).optional(),
    crop: z
      .object({
        top: z.number().min(0).max(1),
        right: z.number().min(0).max(1),
        bottom: z.number().min(0).max(1),
        left: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
  })
  .strict();
const audioFadeCurveSchema = z.enum(['linear', 'equal-power', 'ease-in-out']);
const audioTransitionSchema = z
  .object({
    kind: z.enum(['cut', 'crossfade']),
    durationMs: z.number().int().min(0),
    curve: audioFadeCurveSchema.optional(),
  })
  .strict();
const timelineSourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asset'), assetId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('linked'),
      sourceId: z.string().min(1),
      externalId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('scene'), sceneId: z.string().min(1) }).strict(),
]);

export const videoAgentToolCallSchema = z.discriminatedUnion('name', [
  z.object({
    name: z.literal('proposeOutline'),
    args: z
      .object({
        brief: z.string().min(1),
        durationMs: z.number().int().positive().optional(),
        tone: z.string().min(1).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('estimatePlan'),
    args: z.object({}).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('listTransitionKinds'),
    args: z.object({}).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('addScene'),
    args: z
      .object({
        afterSceneId: z.string().min(1).optional(),
        intent: z.string().min(1),
        durationMs: z.number().int().positive(),
        captionText: z.string().min(1).optional(),
        aspectRatio: aspectRatioSchema.optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setStoryboard'),
    args: z.object({ storyboard: z.unknown() }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('attachAsset'),
    args: z
      .object({
        assetId: z.string().min(1),
        sceneId: z.string().min(1),
        clipId: z.string().min(1),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('splitScene'),
    args: z
      .object({
        sceneId: z.string().min(1),
        atMs: z.number().int().positive(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('removeScene'),
    args: z.object({ sceneId: z.string().min(1) }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('reorderScenes'),
    args: z.object({ order: z.array(z.string().min(1)).min(1) }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setDuration'),
    args: z
      .object({
        sceneId: z.string().min(1),
        durationMs: z.number().int().positive(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setTransition'),
    args: z
      .object({
        sceneId: z.string().min(1),
        transition: transitionSchema,
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setTimelineBookend'),
    args: z
      .object({
        position: timelineBookendPositionSchema,
        kind: z.literal('fade'),
        durationMs: z
          .number()
          .int()
          .min(MIN_BOOKEND_FADE_MS)
          .max(MAX_BOOKEND_FADE_MS),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('clearTimelineBookend'),
    args: z.object({ position: timelineBookendPositionSchema }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setClipAudioSeam'),
    args: z
      .object({
        clipId: z.string().min(1),
        mode: audioSeamModeSchema,
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setKeyframes'),
    args: z
      .object({
        clipId: z.string().min(1),
        property: KeyframeablePropertySchema,
        keys: z.array(KeyframeSchema).max(50),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('applyCaptureToTimeline'),
    args: z
      .object({
        captureId: z.string().min(1),
        targetTrackId: z.string().min(1).optional(),
        atMs: z.number().int().min(0),
        replaceClipId: z.string().min(1).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('proposeTimelineOps'),
    args: z
      .object({
        summary: z.string().min(1).max(280),
        ops: z.array(TimelineOpSchema).min(1).max(20),
        previewRange: previewRangeSchema.optional(),
        recipeId: z.string().min(1).optional(),
        recipeVersion: z.number().int().positive().optional(),
        intentTurn: z.number().int().positive().optional(),
        intentText: z.string().min(1).optional(),
        applyMode: timelineProposalApplyModeSchema.default('suggest'),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('applyTimelineOp'),
    args: z
      .object({
        op: TimelineOpSchema,
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('applyTimelineOps'),
    args: z
      .object({
        ops: z.array(TimelineOpSchema).min(1).max(20),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('cutClip'),
    args: z
      .object({
        clipId: z.string().min(1),
        atFrame: z.number().int().min(0),
        retain: cutRetainSchema.default('both'),
        ripple: z.boolean().optional(),
        linkPolicy: editLinkPolicySchema.default('linked'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('cutRange'),
    args: z
      .object({
        trackId: z.string().min(1).optional(),
        startFrame: z.number().int().min(0),
        endFrame: z.number().int().positive(),
        ripple: z.boolean().optional(),
        summary: z.string().max(280).optional(),
      })
      .strict()
      .refine((range) => range.endFrame > range.startFrame, {
        message: 'endFrame must be after startFrame',
        path: ['endFrame'],
      }),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('duplicateClips'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        placement: duplicatePlacementSchema.default({
          kind: 'after-originals',
        }),
        linkPolicy: editLinkPolicySchema.default('primary-only'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('deleteClips'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(50),
        ripple: z.boolean().optional(),
        linkPolicy: editLinkPolicySchema.default('linked'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('moveClips'),
    args: z
      .object({
        moves: z
          .array(
            z
              .object({
                clipId: z.string().min(1),
                toFrame: z.number().int().min(0),
                toTrackId: z.string().min(1).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(20),
        magnetic: z.boolean().optional(),
        linkPolicy: editLinkPolicySchema.default('linked'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setClipSpeed'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        speed: z.number().min(0.1).max(20),
        timingPolicy: clipPlaybackTimingPolicySchema.default(
          'preserve-source-span',
        ),
        ripple: z.boolean().optional(),
        linkPolicy: editLinkPolicySchema.default('linked'),
        pitchCorrection: z.boolean().optional(),
        smoothSlowMo: z.boolean().optional(),
        interpolationQuality: clipInterpolationQualitySchema.optional(),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('reverseClip'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        reverse: z.boolean(),
        linkPolicy: editLinkPolicySchema.default('linked'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('rotateClip'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        degrees: z.number(),
        relative: z.boolean().optional(),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('flipClip'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        horizontal: z.boolean().optional(),
        vertical: z.boolean().optional(),
        mode: z.enum(['toggle', 'set']).default('toggle'),
        summary: z.string().max(280).optional(),
      })
      .strict()
      .refine((value) => value.horizontal || value.vertical, {
        message: 'At least one flip axis is required',
        path: ['horizontal'],
      }),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setClipTransform'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        transform: clipTransformSchema,
        merge: z.boolean().default(true),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('closeGap'),
    args: z
      .object({
        trackId: z.string().min(1),
        gapStartFrame: z.number().int().min(0),
        gapEndFrame: z.number().int().positive(),
        summary: z.string().max(280).optional(),
      })
      .strict()
      .refine((range) => range.gapEndFrame > range.gapStartFrame, {
        message: 'gapEndFrame must be after gapStartFrame',
        path: ['gapEndFrame'],
      }),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setAudioClipGain'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        gainDb: z.number().min(-96).max(24).nullable(),
        linkPolicy: editLinkPolicySchema.default('primary-only'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setAudioClipMute'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        muted: z.boolean(),
        linkPolicy: editLinkPolicySchema.default('primary-only'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setAudioClipFade'),
    args: z
      .object({
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        edge: z.enum(['in', 'out', 'both']),
        durationMs: z.number().int().min(0),
        curve: audioFadeCurveSchema.optional(),
        linkPolicy: editLinkPolicySchema.default('primary-only'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setAudioTrackVolume'),
    args: z
      .object({
        trackIds: z.array(z.string().min(1)).min(1).max(20),
        volumeDb: z.number().min(-96).max(24).nullable(),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setAudioTrackMute'),
    args: z
      .object({
        trackIds: z.array(z.string().min(1)).min(1).max(20),
        muted: z.boolean(),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setAudioTransition'),
    args: z
      .object({
        clipId: z.string().min(1),
        transition: audioTransitionSchema.nullable(),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('crossfadeAudioClips'),
    args: z
      .object({
        fromClipId: z.string().min(1),
        toClipId: z.string().min(1),
        durationMs: z.number().int().min(0),
        curve: audioFadeCurveSchema.optional(),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setAudioVolumeKeyframes'),
    args: z
      .object({
        clipId: z.string().min(1),
        keys: z.array(KeyframeSchema).max(50),
        mode: z.enum(['replace', 'upsert']).default('replace'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('replaceAudioClipSource'),
    args: z
      .object({
        clipId: z.string().min(1),
        sourceRef: timelineSourceRefSchema,
        sourceDurationMs: z.number().int().min(0).optional(),
        trimStartMs: z.number().int().min(0).optional(),
        name: z.string().min(1).optional(),
        transcriptText: z.string().nullable().optional(),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setCaption'),
    args: z
      .object({
        sceneId: z.string().min(1),
        text: z.string().min(1),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('regenerateScene'),
    args: z
      .object({
        sceneId: z.string().min(1),
        prompt: z.string().min(1).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('generateBRoll'),
    args: z
      .object({
        query: z.string().min(1),
        sceneId: z.string().min(1).optional(),
        rangeMs: z.tuple([
          z.number().int().min(0),
          z.number().int().positive(),
        ]),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('generateVoiceover'),
    args: z
      .object({
        text: z.string().min(1),
        voiceId: z.string().min(1).optional(),
        sceneId: z.string().min(1).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('generateMusic'),
    args: z
      .object({
        mood: z.string().min(1),
        durationMs: z.number().int().positive(),
        tempoBpm: z.number().int().min(40).max(240).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('trimClip'),
    args: z
      .object({
        clipId: z.string().min(1),
        inMs: z.number().int().min(0),
        outMs: z.number().int().positive(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('removeFillerWords'),
    args: z.object({ trackId: z.string().min(1) }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('tightenPacing'),
    args: z.object({ targetDurationMs: z.number().int().positive() }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('duckAudio'),
    args: z
      .object({
        trackId: z.string().min(1),
        underTrackId: z.string().min(1),
        attenuationDb: z.number().max(0),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('addCaptions'),
    args: z.object({ style: subtitleStyleSchema }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('addLowerThird'),
    args: z
      .object({
        sceneId: z.string().min(1),
        text: z.string().min(1),
        style: subtitleStyleSchema.optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('reframe'),
    args: z.object({ aspect: aspectRatioSchema }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('translate'),
    args: z.object({ lang: languageSchema }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('restyle'),
    args: z.object({ preset: z.string().min(1) }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('render'),
    args: z
      .object({
        preset: renderPresetSchema,
        where: renderWhereSchema,
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('cancelRender'),
    args: z.object({}).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('publishTo'),
    args: z.object({ channel: publishChannelSchema }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('searchAssets'),
    args: z
      .object({
        query: z.string().min(1),
        kinds: z.array(providerKindsSchema).optional(),
        sourceIds: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('describeScene'),
    args: z.object({ sceneId: z.string().min(1) }).strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('verifyRender'),
    args: z
      .object({
        outputPath: z.string().min(1).optional(),
        maxIterations: z.number().int().min(1).max(3).default(3),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setOverlayControls'),
    args: z
      .object({
        clipId: z.string().min(1),
        controls: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional(),
        loop: z.enum(['loop', 'hold', 'none']).optional(),
        summary: z.string().max(280).optional(),
      })
      .strict()
      .refine((value) => value.controls || value.loop, {
        message: 'Provide controls and/or loop',
        path: ['controls'],
      }),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setOverlayControlKeyframes'),
    args: z
      .object({
        clipId: z.string().min(1),
        controlId: z.string().min(1),
        keys: z.array(KeyframeSchema).max(50),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('applyOverlayMotionTemplate'),
    args: z
      .object({
        clipId: z.string().min(1),
        templateId: z.enum(VIVID_OVERLAY_MOTION_TEMPLATE_IDS),
        strength: z
          .enum(VIVID_OVERLAY_MOTION_TEMPLATE_STRENGTHS)
          .default('normal'),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
  z.object({
    name: z.literal('setClipParams'),
    args: z
      .object({
        clipId: z.string().min(1),
        patch: z.record(z.string(), z.unknown()),
        summary: z.string().max(280).optional(),
      })
      .strict(),
    reasoning: z.string().optional(),
  }),
]);

export type VideoAgentToolCall = z.infer<typeof videoAgentToolCallSchema>;
export type VideoAgentToolName = VideoAgentToolCall['name'];
export type TimelineEditAgentToolCall = Extract<
  VideoAgentToolCall,
  {
    name:
      | 'cutClip'
      | 'cutRange'
      | 'duplicateClips'
      | 'deleteClips'
      | 'moveClips'
      | 'setClipSpeed'
      | 'reverseClip'
      | 'rotateClip'
      | 'flipClip'
      | 'setClipTransform'
      | 'closeGap'
      | 'setAudioClipGain'
      | 'setAudioClipMute'
      | 'setAudioClipFade'
      | 'setAudioTrackVolume'
      | 'setAudioTrackMute'
      | 'setAudioTransition'
      | 'crossfadeAudioClips'
      | 'setAudioVolumeKeyframes'
      | 'replaceAudioClipSource'
      | 'duckAudio'
      | 'setOverlayControls'
      | 'setOverlayControlKeyframes'
      | 'applyOverlayMotionTemplate'
      | 'setClipParams';
  }
>;
type MoveClipToolMove = Extract<
  TimelineEditAgentToolCall,
  { name: 'moveClips' }
>['args']['moves'][number];

export interface VideoAgentToolExecution {
  project: VideoProject;
  entry: AgentJournalEntry;
}

export interface VideoAgentToolOptions {
  now?: string;
  journalId?: string;
  sceneId?: string;
  /**
   * Project revision the in-flight plan expects, from the revisions its own
   * steps have already committed. Callers that can read the execution log
   * compute it with `expectedProjectRevisionForPlan`; undefined means the plan
   * has landed nothing yet and imposes no constraint.
   */
  expectedProjectRevision?: number;
}

type JsonContainer = Record<string, unknown> | unknown[];

export function applyVideoAgentTool(
  project: VideoProject,
  rawCall: VideoAgentToolCall,
  options: VideoAgentToolOptions = {},
): VideoAgentToolExecution {
  const call = videoAgentToolCallSchema.parse(rawCall);
  const diff = buildVideoAgentToolDiff(project, call, options);
  const inverseDiff = invertDiff(project, diff);
  const patched = normalizePatchedProject(
    applyProjectDiff(project, diff),
    diff,
  );
  const entry: AgentJournalEntry = {
    id: options.journalId ?? randomUUID(),
    ts: options.now ?? new Date().toISOString(),
    tool: call.name,
    args: call.args,
    result: summarizeToolResult(patched, call),
    reasoning: call.reasoning,
    diff,
    inverseDiff,
  };

  return {
    project: {
      ...patched,
      agentJournal: [...(patched.agentJournal ?? []), entry],
      updatedAt: entry.ts,
    },
    entry,
  };
}

export function isTimelineEditAgentToolCall(
  call: VideoAgentToolCall,
): call is TimelineEditAgentToolCall {
  switch (call.name) {
    case 'cutClip':
    case 'cutRange':
    case 'duplicateClips':
    case 'deleteClips':
    case 'moveClips':
    case 'setClipSpeed':
    case 'reverseClip':
    case 'rotateClip':
    case 'flipClip':
    case 'setClipTransform':
    case 'closeGap':
    case 'setAudioClipGain':
    case 'setAudioClipMute':
    case 'setAudioClipFade':
    case 'setAudioTrackVolume':
    case 'setAudioTrackMute':
    case 'setAudioTransition':
    case 'crossfadeAudioClips':
    case 'setAudioVolumeKeyframes':
    case 'replaceAudioClipSource':
    case 'duckAudio':
    case 'setOverlayControls':
    case 'setOverlayControlKeyframes':
    case 'applyOverlayMotionTemplate':
    case 'setClipParams':
      return true;
    default:
      return false;
  }
}

export function undoVideoAgentJournalEntry(
  project: VideoProject,
  entryId: string,
  now = new Date().toISOString(),
): VideoAgentToolExecution {
  const entry = (project.agentJournal ?? []).find(
    (item) => item.id === entryId,
  );
  if (!entry) throw new Error('Agent journal entry not found');
  if (entry.undone) throw new Error('Agent journal entry already undone');
  if (!entry.inverseDiff?.length) {
    throw new Error('Agent journal entry cannot be undone');
  }

  const patched = normalizePatchedProject(
    applyProjectDiff(project, entry.inverseDiff),
    entry.inverseDiff,
  );
  const undoneEntry: AgentJournalEntry = {
    ...entry,
    undone: true,
  };

  return {
    project: {
      ...patched,
      agentJournal: (patched.agentJournal ?? []).map((item) =>
        item.id === entryId ? undoneEntry : item,
      ),
      updatedAt: now,
    },
    entry: undoneEntry,
  };
}

export function redoVideoAgentJournalEntry(
  project: VideoProject,
  entryId: string,
  now = new Date().toISOString(),
): VideoAgentToolExecution {
  const entry = (project.agentJournal ?? []).find(
    (item) => item.id === entryId,
  );
  if (!entry) throw new Error('Agent journal entry not found');
  if (!entry.undone) throw new Error('Agent journal entry is not undone');

  const patched = normalizePatchedProject(
    applyProjectDiff(project, entry.diff),
    entry.diff,
  );
  const redoneEntry: AgentJournalEntry = {
    ...entry,
    undone: false,
  };

  return {
    project: {
      ...patched,
      agentJournal: (patched.agentJournal ?? []).map((item) =>
        item.id === entryId ? redoneEntry : item,
      ),
      updatedAt: now,
    },
    entry: redoneEntry,
  };
}

export function applyProjectDiff(
  project: VideoProject,
  diff: ProjectDiffOperation[],
): VideoProject {
  const document = clone(project);
  for (const operation of diff) {
    applyOperation(document, operation);
  }
  return document;
}

export function invertDiff(
  project: VideoProject,
  diff: ProjectDiffOperation[],
): ProjectDiffOperation[] {
  const inverse: ProjectDiffOperation[] = [];
  const current = clone(project);

  for (const operation of diff) {
    switch (operation.op) {
      case 'add':
        inverse.unshift({ op: 'remove', path: operation.path });
        break;
      case 'remove':
        inverse.unshift({
          op: 'add',
          path: operation.path,
          value: clone(readAt(current, operation.path)),
        });
        break;
      case 'replace':
        inverse.unshift({
          op: 'replace',
          path: operation.path,
          value: clone(readAt(current, operation.path)),
        });
        break;
      default:
        throw new Error(`Unsupported inverse patch operation: ${operation.op}`);
    }
    applyOperation(current, operation);
  }

  return inverse;
}

function buildVideoAgentToolDiff(
  project: VideoProject,
  call: VideoAgentToolCall,
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  switch (call.name) {
    case 'estimatePlan':
      return upsertDiff(project, '/renderPlan', buildRenderPlan(project));
    case 'listTransitionKinds':
      return [];
    case 'addScene':
      return addSceneDiff(project, call.args, options);
    case 'setStoryboard':
      return setStoryboardDiff(
        project,
        parseVideoStoryboard(call.args.storyboard),
        options,
      );
    case 'attachAsset':
      return attachAssetDiff(project, call.args);
    case 'splitScene':
      return splitSceneDiff(project, call.args, options);
    case 'removeScene':
      return removeSceneDiff(project, call.args.sceneId);
    case 'reorderScenes':
      return reorderScenesDiff(project, call.args.order);
    case 'setDuration':
      return setDurationDiff(project, call.args.sceneId, call.args.durationMs);
    case 'setTransition':
      return setTransitionDiff(
        project,
        call.args.sceneId,
        call.args.transition,
      );
    case 'setTimelineBookend':
      return setTimelineBookendDiff(project, call.args);
    case 'clearTimelineBookend':
      return clearTimelineBookendDiff(project, call.args.position);
    case 'setClipAudioSeam':
      return setClipAudioSeamDiff(project, call.args.clipId, call.args.mode);
    case 'setKeyframes':
      return setKeyframesDiff(project, call.args, options);
    case 'applyCaptureToTimeline':
      return applyCaptureToTimelineDiff(project, call.args);
    case 'proposeTimelineOps':
      // Validation + inverse computation happens once in summarizeToolResult.
      // A proposal does not mutate the project; the timeline op reducer is
      // invoked only to verify the ops are applicable.
      return [];
    case 'applyTimelineOp':
      return applyTimelineOpDiff(project, call.args, options);
    case 'applyTimelineOps':
      return applyTimelineOpsDiff(project, call.args, options);
    case 'cutClip':
    case 'cutRange':
    case 'duplicateClips':
    case 'deleteClips':
    case 'moveClips':
    case 'setClipSpeed':
    case 'reverseClip':
    case 'rotateClip':
    case 'flipClip':
    case 'setClipTransform':
    case 'closeGap':
    case 'setAudioClipGain':
    case 'setAudioClipMute':
    case 'setAudioClipFade':
    case 'setAudioTrackVolume':
    case 'setAudioTrackMute':
    case 'setAudioTransition':
    case 'crossfadeAudioClips':
    case 'setAudioVolumeKeyframes':
    case 'replaceAudioClipSource':
    case 'duckAudio':
    case 'setOverlayControls':
    case 'setOverlayControlKeyframes':
    case 'applyOverlayMotionTemplate':
    case 'setClipParams':
      return highLevelTimelineEditDiff(project, call, options);
    case 'setCaption':
      return setCaptionDiff(project, call.args.sceneId, call.args.text);
    case 'regenerateScene':
      return regenerateSceneDiff(project, call.args);
    case 'generateBRoll':
      return generateBRollDiff(project, call.args);
    case 'generateVoiceover':
      return generateVoiceoverDiff(project, call.args, options);
    case 'generateMusic':
      return generateMusicDiff(project, call.args);
    case 'trimClip':
      return trimClipDiff(project, call.args);
    case 'removeFillerWords':
      return removeFillerWordsDiff(project, call.args.trackId);
    case 'tightenPacing':
      return tightenPacingDiff(project, call.args.targetDurationMs);
    case 'addCaptions':
      return addCaptionsDiff(project, call.args.style);
    case 'addLowerThird':
      return addLowerThirdDiff(project, call.args, options);
    case 'reframe':
      return reframeDiff(project, call.args.aspect);
    case 'translate':
      return translateDiff(project, call.args.lang);
    case 'restyle':
      return restyleDiff(project, call.args.preset);
    case 'render':
    case 'cancelRender':
    case 'publishTo':
    case 'searchAssets':
    case 'verifyRender':
      return [];
    default:
      throw new Error(`${call.name} is not yet a diffable video agent tool`);
  }
}

function addSceneDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'addScene' }>['args'],
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const storyboard = getOrInitStoryboard(project);
  const insertIndex = args.afterSceneId
    ? sceneIndex(storyboard, args.afterSceneId) + 1
    : storyboard.scenes.length;
  const aspectRatio =
    args.aspectRatio ??
    project.settings?.defaultAspectRatios?.[0] ??
    ('16:9' satisfies AspectRatio);
  const scene: StoryboardScene = {
    id: options.sceneId ?? randomUUID(),
    durationMs: args.durationMs,
    intent: args.intent,
    ...(args.captionText ? { caption: { text: args.captionText } } : {}),
    transition: 'cut',
    assetPlan: defaultAddSceneAssetPlan(project, args, aspectRatio),
  };
  const scenes = insertIntoArray(storyboard.scenes, insertIndex, scene);
  const ops: ProjectDiffOperation[] = project.storyboard
    ? [
        { op: 'add', path: `/storyboard/scenes/${insertIndex}`, value: scene },
        totalDurationDiff({ ...project, storyboard }, scenes),
      ]
    : [
        {
          op: 'add',
          path: '/storyboard',
          value: {
            ...storyboard,
            scenes: [scene],
            totalDurationMs: scene.durationMs,
          },
        },
      ];
  return storyboardEditDiff(project, ops);
}

function setStoryboardDiff(
  project: VideoProject,
  storyboard: Storyboard,
  options: VideoAgentToolOptions = {},
): ProjectDiffOperation[] {
  const plan = project.agentPlan;
  if (!plan || plan.status === 'superseded') {
    throw new Error(
      'A durable video plan is required — call video_write_plan first',
    );
  }
  // Only an in-flight plan constrains the revision. `expectedProjectRevision`
  // is undefined until the plan lands its first step, because an edit made
  // before the plan started is not a conflict with it.
  const expectedRevision = options.expectedProjectRevision;
  if (expectedRevision !== undefined && project.revision !== expectedRevision) {
    throw new Error(
      `Project revision conflict: plan expects ${expectedRevision}, current ${project.revision}`,
    );
  }
  const sceneIds = new Set<string>();
  for (const scene of storyboard.scenes) {
    if (sceneIds.has(scene.id))
      throw new Error(`Duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    for (const assetId of assetIdsForPlan(scene.assetPlan)) {
      if (!project.assets.some((asset) => asset.id === assetId)) {
        throw new Error(`Storyboard references unknown asset: ${assetId}`);
      }
    }
  }
  const totalDurationMs = storyboard.scenes.reduce(
    (total, scene) => total + scene.durationMs,
    0,
  );
  if (storyboard.totalDurationMs !== totalDurationMs) {
    throw new Error(
      `Storyboard totalDurationMs ${storyboard.totalDurationMs} does not match scene total ${totalDurationMs}`,
    );
  }
  return [
    project.storyboard
      ? { op: 'replace', path: '/storyboard', value: storyboard }
      : { op: 'add', path: '/storyboard', value: storyboard },
  ];
}

export function parseVideoStoryboard(value: unknown): Storyboard {
  // Zod has validated every nested field at this external-data boundary.
  return videoStoryboardSchema.parse(value) as Storyboard;
}

function assetIdsForPlan(assetPlan: AssetPlan): string[] {
  switch (assetPlan.kind) {
    case 'existing':
    case 'image-pan':
      return [assetPlan.assetId];
    case 'ai-image':
      return assetPlan.refImageIds ?? [];
    case 'ai-clip':
      return [assetPlan.refImageId, assetPlan.refImageTailId].filter(
        (id): id is string => Boolean(id),
      );
    case 'lipsync':
      return [
        assetPlan.referenceImageAssetId,
        ...(assetPlan.background?.kind === 'image'
          ? [assetPlan.background.assetId]
          : []),
      ];
    case 'broll-search':
    case 'tts-narration':
      return [];
  }
}

function attachAssetDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'attachAsset' }>['args'],
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  // The storyboard is the scene registry, and `sceneIndex` already rejects an
  // unknown id against it.
  const storyboardIndex = sceneIndex(storyboard, args.sceneId);
  if (!project.assets.some((asset) => asset.id === args.assetId)) {
    throw new Error(`Asset not found: ${args.assetId}`);
  }
  // `project.scenes` is the flattened projection `approveStoryboard` writes,
  // so it is empty for every storyboard still being built — which is exactly
  // when assets are attached. Mirror the clip into it when it exists, and
  // otherwise let the storyboard stand alone; `normalizePatchedProject`
  // rebuilds the timeline from the storyboard either way.
  const projectionIndex = (project.scenes ?? []).findIndex(
    (scene) => scene.id === args.sceneId,
  );
  return storyboardEditDiff(project, [
    {
      op: 'replace',
      path: `/storyboard/scenes/${storyboardIndex}/assetPlan`,
      value: { kind: 'existing', assetId: args.assetId },
    },
    ...(projectionIndex >= 0
      ? [
          {
            op: 'replace',
            path: `/scenes/${projectionIndex}/clips`,
            value: [{ id: args.clipId, mediaId: args.assetId }],
          } satisfies ProjectDiffOperation,
        ]
      : []),
  ]);
}

function defaultAddSceneAssetPlan(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'addScene' }>['args'],
  aspectRatio: AspectRatio,
): AssetPlan {
  const sourceAsset = sourceVideoAssetForAddedScene(project, args);
  if (sourceAsset) {
    const trimMs = nextTrimForAsset(project, sourceAsset, args.durationMs);
    return trimMs
      ? { kind: 'existing', assetId: sourceAsset.id, trimMs }
      : { kind: 'existing', assetId: sourceAsset.id };
  }
  return {
    kind: 'ai-image',
    prompt: args.intent,
    aspectRatio,
  };
}

function sourceVideoAssetForAddedScene(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'addScene' }>['args'],
): MediaItem | undefined {
  const haystack = [args.intent, args.captionText].filter(Boolean).join(' ');
  if (TITLE_CARD_SCENE_RE.test(haystack)) return undefined;
  if (!SOURCE_FOOTAGE_SCENE_RE.test(haystack)) return undefined;
  return project.assets
    .filter((asset) => asset.kind === 'video')
    .sort((a, b) => mediaAssetScore(b) - mediaAssetScore(a))[0];
}

function mediaAssetScore(asset: MediaItem): number {
  let score = asset.metadata.durationMs > 0 ? 4 : 0;
  if (asset.provenance?.sourceDisplayName) score += 2;
  if (asset.provenance?.catalogAssetId) score += 1;
  return score;
}

function nextTrimForAsset(
  project: VideoProject,
  asset: MediaItem,
  durationMs: number,
): [number, number] | undefined {
  if (asset.kind !== 'video' || asset.metadata.durationMs <= 0)
    return undefined;
  let cursorMs = 0;
  for (const scene of project.storyboard?.scenes ?? []) {
    if (scene.assetPlan.kind !== 'existing') continue;
    if (scene.assetPlan.assetId !== asset.id) continue;
    cursorMs = Math.max(
      cursorMs,
      scene.assetPlan.trimMs?.[1] ?? cursorMs + scene.durationMs,
    );
  }
  const startMs = Math.min(
    cursorMs,
    Math.max(asset.metadata.durationMs - 1, 0),
  );
  const endMs = Math.min(asset.metadata.durationMs, startMs + durationMs);
  return endMs > startMs ? [startMs, endMs] : undefined;
}

function getOrInitStoryboard(project: VideoProject): Storyboard {
  if (project.storyboard) return project.storyboard;
  return {
    status: 'draft',
    intent: project.prompt ?? '',
    totalDurationMs: 0,
    costEstimateUsd: { low: 0, high: 0 },
    scenes: [],
  };
}

function splitSceneDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'splitScene' }>['args'],
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const index = sceneIndex(storyboard, args.sceneId);
  const scene = sceneAt(storyboard, index);
  if (args.atMs >= scene.durationMs) {
    throw new Error('Split point must be inside the scene duration');
  }

  const first: StoryboardScene = {
    ...scene,
    durationMs: args.atMs,
  };
  const second: StoryboardScene = {
    ...scene,
    id: options.sceneId ?? randomUUID(),
    durationMs: scene.durationMs - args.atMs,
    intent: `${scene.intent} continuation`,
  };

  return storyboardEditDiff(project, [
    { op: 'replace', path: `/storyboard/scenes/${index}`, value: first },
    { op: 'add', path: `/storyboard/scenes/${index + 1}`, value: second },
  ]);
}

function removeSceneDiff(
  project: VideoProject,
  sceneId: string,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  if (storyboard.scenes.length === 1) {
    throw new Error('Storyboard needs at least one scene');
  }
  const index = sceneIndex(storyboard, sceneId);
  const scenes = storyboard.scenes.filter((scene) => scene.id !== sceneId);
  return storyboardEditDiff(project, [
    { op: 'remove', path: `/storyboard/scenes/${index}` },
    totalDurationDiff(project, scenes),
  ]);
}

function reorderScenesDiff(
  project: VideoProject,
  order: string[],
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  if (new Set(order).size !== storyboard.scenes.length) {
    throw new Error('Scene order must include each scene exactly once');
  }
  const byId = new Map(storyboard.scenes.map((scene) => [scene.id, scene]));
  const scenes = order.map((id) => {
    const scene = byId.get(id);
    if (!scene) throw new Error(`Scene not found: ${id}`);
    return scene;
  });
  return storyboardEditDiff(project, [
    { op: 'replace', path: '/storyboard/scenes', value: scenes },
  ]);
}

function setDurationDiff(
  project: VideoProject,
  sceneId: string,
  durationMs: number,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const index = sceneIndex(storyboard, sceneId);
  const scenes = storyboard.scenes.map((scene) =>
    scene.id === sceneId ? { ...scene, durationMs } : scene,
  );
  return storyboardEditDiff(project, [
    {
      op: 'replace',
      path: `/storyboard/scenes/${index}/durationMs`,
      value: durationMs,
    },
    totalDurationDiff(project, scenes),
  ]);
}

function setTransitionDiff(
  project: VideoProject,
  sceneId: string,
  transition: StoryboardScene['transition'],
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const index = sceneIndex(storyboard, sceneId);
  const scene = sceneAt(storyboard, index);
  const nextTransition = compactTransition(transition ?? 'cut');
  return storyboardEditDiff(project, [
    {
      op: scene.transition ? 'replace' : 'add',
      path: `/storyboard/scenes/${index}/transition`,
      value: nextTransition,
    },
  ]);
}

function compactTransition(transition: TimelineTransition): TimelineTransition {
  const normalized = normalizeTransition(transition);
  return normalized.durationMs || normalized.direction
    ? normalized
    : normalized.kind;
}

function setTimelineBookendDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'setTimelineBookend' }>['args'],
): ProjectDiffOperation[] {
  const timeline = editableTimeline(project);
  if (timeline[args.position]?.durationMs === args.durationMs) return [];
  return replaceTimelineDiff(project, {
    ...timeline,
    [args.position]: { kind: 'fade', durationMs: args.durationMs },
  });
}

function clearTimelineBookendDiff(
  project: VideoProject,
  position: 'intro' | 'outro',
): ProjectDiffOperation[] {
  const timeline = editableTimeline(project);
  if (!timeline[position]) return [];
  const nextTimeline: VideoTimeline = { ...timeline };
  delete nextTimeline[position];
  return replaceTimelineDiff(project, nextTimeline);
}

function setClipAudioSeamDiff(
  project: VideoProject,
  clipId: string,
  mode: 'follow' | 'cut',
): ProjectDiffOperation[] {
  const timeline = editableTimeline(project);
  let found = false;
  let changed = false;
  const tracks = timeline.tracks.map((track) => {
    if (
      track.kind !== 'video' &&
      track.kind !== 'broll' &&
      track.kind !== 'overlay'
    ) {
      return track;
    }
    const clips = track.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      found = true;
      if (
        clip.kind !== 'video' &&
        clip.kind !== 'image' &&
        clip.kind !== 'overlay'
      ) {
        throw new Error(`Clip is not visual: ${clipId}`);
      }
      if (mode === 'follow') {
        if (!clip.audioSeamToNext) return clip;
        changed = true;
        const nextClip = { ...clip };
        delete nextClip.audioSeamToNext;
        return nextClip;
      }
      if (clip.audioSeamToNext === mode) return clip;
      changed = true;
      return { ...clip, audioSeamToNext: mode };
    });
    return { ...track, clips };
  }) satisfies VideoTimeline['tracks'];

  if (!found) throw new Error(`Clip not found: ${clipId}`);
  return changed ? replaceTimelineDiff(project, { ...timeline, tracks }) : [];
}

function setKeyframesDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'setKeyframes' }>['args'],
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const timeline = editableTimeline(project);
  const location = findTimelineClip(timeline.tracks, args.clipId);
  if (!location) throw new Error(`Clip not found: ${args.clipId}`);
  const before =
    location.clip.keyframes?.find(
      (track) => track.property === args.property,
    ) ?? null;
  const after: KeyframeTrack | null =
    args.keys.length > 0 ? { property: args.property, keys: args.keys } : null;
  const op: TimelineOp = {
    kind: 'keyframe.setTrack',
    clipId: args.clipId,
    property: args.property,
    before,
    after,
  };
  return applyTimelineOpsDiff(
    project,
    {
      ops: [op],
      summary:
        args.summary ?? `Set ${args.property} keyframes on clip ${args.clipId}`,
    },
    options,
  );
}

function applyCaptureToTimelineDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'applyCaptureToTimeline' }>['args'],
): ProjectDiffOperation[] {
  const source = (project.sources ?? []).find(
    (item) => item.id === args.captureId && item.origin === 'capture',
  );
  if (!source) throw new Error(`Capture not found: ${args.captureId}`);
  const asset = project.assets.find((item) => item.id === source.mediaItemId);
  if (!asset) throw new Error(`Capture asset not found: ${source.mediaItemId}`);

  const timeline = editableTimeline(project);
  const sourceDurationMs = captureDurationMs(asset);
  const clip = buildCaptureTimelineClip({
    id: `clip-capture-${source.id}-${randomUUID()}`,
    source,
    asset,
    startMs: Math.max(0, Math.round(args.atMs)),
    durationMs: sourceDurationMs,
    sourceDurationMs,
  });

  if (args.replaceClipId) {
    const replacement = findTimelineClip(timeline.tracks, args.replaceClipId);
    if (!replacement) throw new Error(`Clip not found: ${args.replaceClipId}`);
    if (!trackAcceptsCaptureAsset(replacement.track, asset)) {
      throw new Error('Selected track does not accept this capture');
    }
    const replacementClip: TimelineClip = {
      ...clip,
      startMs: replacement.clip.startMs,
      sceneId: replacement.clip.sceneId,
    };
    const tracks = timeline.tracks.map((track) =>
      track.id === replacement.track.id
        ? ({
            ...track,
            clips: track.clips.map((item) =>
              item.id === args.replaceClipId ? replacementClip : item,
            ),
          } as TimelineTrack)
        : track,
    );
    const nextTimeline = insertCaptureCaptionClips(
      {
        ...timeline,
        tracks,
        durationMs: pictureTimelineDurationMs(tracks),
      },
      {
        captureId: source.id,
        captureClipId: replacementClip.id,
        assetId: asset.id,
        timelineStartMs: replacementClip.startMs,
        sourceDurationMs,
        sceneId: replacementClip.sceneId,
        subtitles: asset.metadata.subtitles ?? [],
      },
    );
    return replaceTimelineDiff(project, nextTimeline);
  }

  const { track, tracks } = resolveCaptureTargetTrack(
    timeline.tracks,
    asset,
    args.targetTrackId,
  );
  const nextTracks = tracks.map((item) =>
    item.id === track.id
      ? ({ ...item, clips: [...item.clips, clip] } as TimelineTrack)
      : item,
  );
  const nextTimeline = insertCaptureCaptionClips(
    {
      ...timeline,
      tracks: nextTracks,
      durationMs: pictureTimelineDurationMs(nextTracks),
    },
    {
      captureId: source.id,
      captureClipId: clip.id,
      assetId: asset.id,
      timelineStartMs: clip.startMs,
      sourceDurationMs,
      subtitles: asset.metadata.subtitles ?? [],
    },
  );
  return replaceTimelineDiff(project, nextTimeline);
}

function buildCaptureTimelineClip(input: {
  id: string;
  source: SourceMedia;
  asset: MediaItem;
  startMs: number;
  durationMs: number;
  sourceDurationMs: number;
}): TimelineClip {
  const base = {
    id: input.id,
    name: captureClipName(input.source, input.asset),
    sourceRef: { kind: 'asset' as const, assetId: input.asset.id },
    startMs: input.startMs,
    durationMs: input.durationMs,
    trimStartMs: 0,
    trimEndMs: input.durationMs,
    sourceDurationMs: input.sourceDurationMs,
    params: { captureId: input.source.id, origin: 'capture' },
  };
  if (input.asset.kind === 'audio') {
    return {
      ...base,
      kind: 'audio',
      fadeInMs: 0,
      fadeOutMs: 0,
    };
  }
  return {
    ...base,
    kind: input.asset.kind === 'image' ? 'image' : 'video',
    muted: false,
  };
}

function resolveCaptureTargetTrack(
  tracks: TimelineTrack[],
  asset: MediaItem,
  targetTrackId: string | undefined,
): { track: TimelineTrack; tracks: TimelineTrack[] } {
  const requested = targetTrackId
    ? tracks.find((track) => track.id === targetTrackId)
    : undefined;
  if (requested && trackAcceptsCaptureAsset(requested, asset)) {
    return { track: requested, tracks };
  }
  const existing = tracks.find((track) =>
    trackAcceptsCaptureAsset(track, asset),
  );
  if (existing) return { track: existing, tracks };
  const track = buildCaptureTrack(tracks, asset);
  return { track, tracks: [...tracks, track] };
}

function buildCaptureTrack(
  tracks: TimelineTrack[],
  asset: MediaItem,
): TimelineTrack {
  const visual = asset.kind !== 'audio';
  return {
    id: uniqueTrackId(
      tracks,
      visual ? 'track-video-capture' : 'track-audio-capture',
    ),
    kind: visual ? 'video' : 'audio-vo',
    name: visual ? 'Captured Video' : 'Captured Audio',
    muted: false,
    locked: false,
    order: nextTrackOrder(tracks, visual),
    clips: [],
  } as TimelineTrack;
}

function trackAcceptsCaptureAsset(
  track: TimelineTrack,
  asset: MediaItem,
): boolean {
  if (track.locked) return false;
  if (asset.kind === 'audio') return track.kind.startsWith('audio-');
  return isVisualTimelineTrackKind(track.kind);
}

function isVisualTimelineTrackKind(kind: TimelineTrack['kind']): boolean {
  return kind === 'video' || kind === 'broll' || kind === 'overlay';
}

function findTimelineClip(
  tracks: TimelineTrack[],
  clipId: string,
): { track: TimelineTrack; clip: TimelineClip } | null {
  for (const track of tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function captureDurationMs(asset: MediaItem): number {
  return Math.max(100, Math.round(asset.metadata.durationMs || 1000));
}

function captureClipName(source: SourceMedia, asset: MediaItem): string {
  const durationSec = Math.max(1, Math.round(captureDurationMs(asset) / 1000));
  return `Capture ${source.id.slice(0, 8)} (${durationSec}s)`;
}

function uniqueTrackId(tracks: TimelineTrack[], baseId: string): string {
  const ids = new Set(tracks.map((track) => track.id));
  if (!ids.has(baseId)) return baseId;
  let index = 2;
  while (ids.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

function nextTrackOrder(tracks: TimelineTrack[], visual: boolean): number {
  const matching = tracks.filter((track) =>
    visual
      ? isVisualTimelineTrackKind(track.kind)
      : track.kind.startsWith('audio-'),
  );
  return Math.max(-10, ...matching.map((track) => track.order)) + 10;
}

function setCaptionDiff(
  project: VideoProject,
  sceneId: string,
  text: string,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const index = sceneIndex(storyboard, sceneId);
  const scene = sceneAt(storyboard, index);
  return storyboardEditDiff(project, [
    {
      op: scene.caption ? 'replace' : 'add',
      path: `/storyboard/scenes/${index}/caption`,
      value: {
        text,
        style: scene.caption?.style,
      },
    },
  ]);
}

function regenerateSceneDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'regenerateScene' }>['args'],
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const index = sceneIndex(storyboard, args.sceneId);
  const scene = sceneAt(storyboard, index);
  const prompt = args.prompt ?? scene.intent;
  const assetPlan: AssetPlan =
    scene.assetPlan.kind === 'ai-clip'
      ? { ...scene.assetPlan, prompt }
      : {
          kind: 'ai-image',
          prompt,
          aspectRatio: project.settings?.defaultAspectRatios?.[0] ?? '16:9',
        };
  return storyboardEditDiff(project, [
    {
      op: 'replace',
      path: `/storyboard/scenes/${index}/assetPlan`,
      value: assetPlan,
    },
  ]);
}

function generateBRollDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'generateBRoll' }>['args'],
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const targetSceneId = args.sceneId ?? storyboard.scenes[0]?.id;
  if (!targetSceneId) throw new Error('Storyboard scene required');
  const index = sceneIndex(storyboard, targetSceneId);
  const plan: AssetPlan = {
    kind: 'broll-search',
    query: args.query,
    provider: 'linked',
  };
  return storyboardEditDiff(project, [
    {
      op: 'replace',
      path: `/storyboard/scenes/${index}/assetPlan`,
      value: plan,
    },
  ]);
}

function generateVoiceoverDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'generateVoiceover' }>['args'],
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const targetSceneId = args.sceneId ?? storyboard.scenes[0]?.id;
  if (!targetSceneId) throw new Error('Storyboard scene required');
  sceneIndex(storyboard, targetSceneId);
  const current = storyboard.narration;
  const segments = [...(current?.segments ?? [])];
  const existingIndex = segments.findIndex(
    (segment) => segment.sceneId === targetSceneId,
  );
  const nextSegment = {
    id:
      existingIndex >= 0
        ? requireArrayItem(segments, existingIndex, 'Narration segment').id
        : (options.sceneId ?? randomUUID()),
    sceneId: targetSceneId,
    text: args.text,
    voiceId: args.voiceId ?? current?.voiceId,
    provider: current?.provider,
  };
  if (existingIndex >= 0) {
    segments[existingIndex] = nextSegment;
  } else {
    segments.push(nextSegment);
  }

  return storyboardEditDiff(project, [
    ...upsertDiff(project, '/storyboard/narration', {
      ...current,
      segments,
      voiceId: args.voiceId ?? current?.voiceId,
    }),
  ]);
}

function generateMusicDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'generateMusic' }>['args'],
): ProjectDiffOperation[] {
  requireStoryboard(project);
  const music: MusicPlan = {
    prompt: args.mood,
    mood: args.mood,
    durationMs: args.durationMs,
    tempoBpm: args.tempoBpm,
    provider: 'elevenlabs-music',
  };
  return storyboardEditDiff(
    project,
    upsertDiff(project, '/storyboard/music', music),
  );
}

function trimClipDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'trimClip' }>['args'],
): ProjectDiffOperation[] {
  if (args.outMs <= args.inMs) {
    throw new Error('Clip trim outMs must be greater than inMs');
  }
  const timeline = editableTimeline(project);
  let found = false;
  const tracks = timeline.tracks.map((track) => {
    const clips = track.clips.map((clip) => {
      if (clip.id !== args.clipId) return clip;
      found = true;
      const sourceDurationMs = clip.sourceDurationMs ?? clip.trimEndMs;
      if (args.outMs > sourceDurationMs) {
        throw new Error(
          `Clip trim outMs exceeds source duration ${sourceDurationMs}`,
        );
      }
      return {
        ...clip,
        trimStartMs: args.inMs,
        trimEndMs: args.outMs,
        durationMs: args.outMs - args.inMs,
      } satisfies TimelineClip;
    });
    return { ...track, clips } as TimelineTrack;
  });
  if (!found) throw new Error(`Clip not found: ${args.clipId}`);
  return replaceTimelineDiff(project, {
    ...timeline,
    tracks,
    durationMs: pictureTimelineDurationMs(tracks),
  });
}

function removeFillerWordsDiff(
  project: VideoProject,
  trackId: string,
): ProjectDiffOperation[] {
  const timeline = editableTimeline(project);
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  if (
    track.kind !== 'audio-vo' &&
    track.kind !== 'audio-music' &&
    track.kind !== 'audio-sfx'
  ) {
    throw new Error(`Track is not audio: ${trackId}`);
  }
  const markers = [
    ...(timeline.markers ?? []),
    {
      id: `marker-filler-${randomUUID()}`,
      timeMs: 0,
      label: `Review filler-word cleanup on ${track.name}`,
      color: 'yellow' as const,
      comment:
        'Agent requested filler-word cleanup. Apply transcript-derived timeline ops before rendering.',
    },
  ];
  return replaceTimelineDiff(project, { ...timeline, markers });
}

function tightenPacingDiff(
  project: VideoProject,
  targetDurationMs: number,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const currentDurationMs = Math.max(1, storyboard.totalDurationMs);
  const ratio = targetDurationMs / currentDurationMs;
  const scenes = storyboard.scenes.map((scene) => ({
    ...scene,
    durationMs: Math.max(500, Math.round(scene.durationMs * ratio)),
  }));
  const operations = scenes.map<ProjectDiffOperation>((scene, index) => ({
    op: 'replace',
    path: `/storyboard/scenes/${index}/durationMs`,
    value: scene.durationMs,
  }));
  return storyboardEditDiff(project, [
    ...operations,
    totalDurationDiff(project, scenes),
  ]);
}

function reframeDiff(
  project: VideoProject,
  aspect: AspectRatio,
): ProjectDiffOperation[] {
  if (!project.settings) {
    return [
      {
        op: 'add',
        path: '/settings',
        value: { defaultAspectRatios: [aspect] },
      },
    ];
  }
  return upsertDiff(project, '/settings/defaultAspectRatios', [aspect]);
}

function addCaptionsDiff(
  project: VideoProject,
  style: SubtitleStyle,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const operations = storyboard.scenes.map<ProjectDiffOperation>(
    (scene, index) => ({
      op: scene.caption ? 'replace' : 'add',
      path: `/storyboard/scenes/${index}/caption`,
      value: {
        text: scene.caption?.text ?? scene.intent,
        style,
      },
    }),
  );
  return storyboardEditDiff(project, operations);
}

function addLowerThirdDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'addLowerThird' }>['args'],
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  sceneIndex(storyboard, args.sceneId);
  const timeline = editableTimeline(project);
  const visualClip = findFirstSceneClip(timeline.tracks, args.sceneId);
  const sceneStartMs =
    visualClip?.startMs ?? storyboardSceneStartMs(storyboard, args.sceneId);
  const sceneDurationMs =
    visualClip?.durationMs ??
    storyboard.scenes.find((scene) => scene.id === args.sceneId)?.durationMs ??
    3000;
  const durationMs = Math.min(sceneDurationMs, 5000);
  const overlayClip = {
    id: options.sceneId ?? `lower-third-${randomUUID()}`,
    kind: 'overlay',
    name: 'Lower third',
    sourceRef: { kind: 'scene', sceneId: args.sceneId },
    sceneId: args.sceneId,
    startMs: sceneStartMs,
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    params: {
      overlay: 'lower-third',
      text: args.text,
      style: args.style,
    },
  } satisfies VisualTimelineClip;
  const existingOverlayTrack = timeline.tracks.find(
    (track) => track.kind === 'overlay' && !track.locked,
  );
  const tracks: TimelineTrack[] = existingOverlayTrack
    ? timeline.tracks.map((track): TimelineTrack =>
        track.id === existingOverlayTrack.id && track.kind === 'overlay'
          ? { ...track, clips: [...track.clips, overlayClip] }
          : track,
      )
    : [
        ...timeline.tracks,
        {
          id: uniqueTrackId(timeline.tracks, 'track-overlay-lower-thirds'),
          kind: 'overlay',
          name: 'Lower thirds',
          muted: false,
          locked: false,
          order: nextTrackOrder(timeline.tracks, true),
          clips: [overlayClip],
        } satisfies TimelineTrack,
      ];
  return replaceTimelineDiff(project, {
    ...timeline,
    tracks,
    durationMs: pictureTimelineDurationMs(tracks),
  });
}

function findFirstSceneClip(
  tracks: TimelineTrack[],
  sceneId: string,
): TimelineClip | undefined {
  for (const track of tracks) {
    const clip = track.clips.find((item) => item.sceneId === sceneId);
    if (clip) return clip;
  }
  return undefined;
}

function storyboardSceneStartMs(
  storyboard: Storyboard,
  sceneId: string,
): number {
  let cursor = 0;
  for (const scene of storyboard.scenes) {
    if (scene.id === sceneId) return cursor;
    cursor += scene.durationMs;
  }
  throw new Error(`Scene not found: ${sceneId}`);
}

function translateDiff(
  project: VideoProject,
  lang: Extract<VideoAgentToolCall, { name: 'translate' }>['args']['lang'],
): ProjectDiffOperation[] {
  const nextSettings = {
    ...(project.settings ?? {}),
    translationLanguage: lang,
  };
  return upsertDiff(project, '/settings', nextSettings);
}

function restyleDiff(
  project: VideoProject,
  preset: string,
): ProjectDiffOperation[] {
  const nextSettings = {
    ...(project.settings ?? {}),
    autoColorEnabled: true,
    stylePreset: preset,
  };
  return upsertDiff(project, '/settings', nextSettings);
}

function storyboardEditDiff(
  project: VideoProject,
  operations: ProjectDiffOperation[],
): ProjectDiffOperation[] {
  const storyboard = requireStoryboard(project);
  const status =
    storyboard.status === 'approved'
      ? storyboard.status
      : ('edited' satisfies Storyboard['status']);
  const statusOperation =
    status !== storyboard.status
      ? [
          {
            op: 'replace',
            path: '/storyboard/status',
            value: status,
          } satisfies ProjectDiffOperation,
        ]
      : [];
  const renderPlanInvalidation = project.renderPlan
    ? [{ op: 'remove', path: '/renderPlan' } satisfies ProjectDiffOperation]
    : [];
  return [...operations, ...statusOperation, ...renderPlanInvalidation];
}

function totalDurationDiff(
  project: VideoProject,
  scenes: StoryboardScene[],
): ProjectDiffOperation {
  requireStoryboard(project);
  return {
    op: 'replace',
    path: '/storyboard/totalDurationMs',
    value: scenes.reduce((total, scene) => total + scene.durationMs, 0),
  };
}

function summarizeToolResult(
  project: VideoProject,
  call: VideoAgentToolCall,
): Record<string, unknown> {
  if (call.name === 'estimatePlan') {
    return { renderPlan: project.renderPlan };
  }
  if (call.name === 'listTransitionKinds') {
    return { transitions: VIDEO_TRANSITION_REGISTRY };
  }
  if (call.name === 'verifyRender') {
    return buildRenderVerificationReport(project, call.args);
  }
  if (call.name === 'applyCaptureToTimeline') {
    return {
      projectId: project.id,
      captureId: call.args.captureId,
      timelineDurationMs: project.timeline?.durationMs,
    };
  }
  if (call.name === 'proposeTimelineOps') {
    const proposal = proposeProjectTimelineOps(project, { ops: call.args.ops });
    return {
      schema: 'neuma.video.timeline-proposal.v1',
      projectId: project.id,
      summary: call.args.summary,
      opCount: call.args.ops.length,
      opKinds: call.args.ops.map((op) => op.kind),
      inverses: proposal.inverses,
      conflicts: proposal.conflicts,
      previewRange: call.args.previewRange,
      recipeId: call.args.recipeId,
      recipeVersion: call.args.recipeVersion,
      intentTurn: call.args.intentTurn,
      applyMode: call.args.applyMode,
      timelineDurationMs: proposal.timeline.durationMs,
    };
  }
  if (call.name === 'applyTimelineOp') {
    const acceptedOpId = acceptedTimelineOpId(project);
    return {
      projectId: project.id,
      opKind: call.args.op.kind,
      timelineDurationMs: project.timeline?.durationMs,
      historyHead: project.history?.head ?? 0,
      acceptedOpId,
    };
  }
  if (call.name === 'applyTimelineOps') {
    const acceptedOpId = acceptedTimelineOpId(project);
    return {
      projectId: project.id,
      opCount: call.args.ops.length,
      opKinds: call.args.ops.map((op) => op.kind),
      timelineDurationMs: project.timeline?.durationMs,
      historyHead: project.history?.head ?? 0,
      acceptedOpId,
    };
  }
  if (isTimelineEditAgentToolCall(call)) {
    const acceptedOpId = acceptedTimelineOpId(project);
    return {
      projectId: project.id,
      tool: call.name,
      timelineDurationMs: project.timeline?.durationMs,
      historyHead: project.history?.head ?? 0,
      acceptedOpId,
    };
  }
  if (call.name === 'setKeyframes') {
    const acceptedOpId = acceptedTimelineOpId(project);
    return {
      projectId: project.id,
      clipId: call.args.clipId,
      property: call.args.property,
      keyCount: call.args.keys.length,
      timelineDurationMs: project.timeline?.durationMs,
      historyHead: project.history?.head ?? 0,
      acceptedOpId,
    };
  }
  return {
    projectId: project.id,
    storyboardStatus: project.storyboard?.status,
    sceneCount: project.storyboard?.scenes.length ?? 0,
  };
}

function buildRenderVerificationReport(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'verifyRender' }>['args'],
): Record<string, unknown> {
  const edl = compileTimelineToEdl(project);
  const failures: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  const outputPath =
    args.outputPath ??
    project.render?.outputPath ??
    project.outputs?.at(-1)?.path;

  if (!outputPath) {
    failures.push({
      code: 'render-output-missing',
      message: 'No rendered output path is available to verify.',
    });
  }

  addVisualContinuityFailures(edl, failures);
  addCaptionBoundaryFailures(project, edl, failures);
  addAudioFadeFailures(edl, failures);

  const expectedTranscript = expectedProjectTranscript(project);
  const renderedTranscript = renderedTranscriptHypothesis(edl);
  const transcriptWer =
    expectedTranscript && renderedTranscript
      ? calculateWer(expectedTranscript, renderedTranscript)
      : undefined;
  if (expectedTranscript && !renderedTranscript) {
    warnings.push('render-transcript-unavailable');
  }
  if (
    transcriptWer != null &&
    Number.isFinite(transcriptWer) &&
    transcriptWer > TRANSCRIPT_WER_THRESHOLD
  ) {
    failures.push({
      code: 'transcript-mismatch',
      message: `Rendered transcript WER ${transcriptWer.toFixed(
        3,
      )} exceeds ${TRANSCRIPT_WER_THRESHOLD}.`,
      wer: transcriptWer,
    });
  }

  return {
    schema: 'neuma.video.render-verification.v1',
    projectId: project.id,
    outputPath,
    status: failures.length > 0 ? 'failed' : 'passed',
    maxIterations: args.maxIterations,
    checks: {
      visualSegments: edl.segments.length,
      captions: edl.captions.length,
      audioClips: edl.audioTracks.reduce(
        (total, track) => total + track.clips.length,
        0,
      ),
    },
    transcriptWer,
    warnings,
    failures,
  };
}

function addVisualContinuityFailures(
  edl: EditDecisionList,
  failures: Array<Record<string, unknown>>,
): void {
  const segments = [...edl.segments].sort(
    (a, b) => a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id),
  );
  if (segments.length === 0) {
    failures.push({
      code: 'visual-segments-missing',
      message: 'No visual timeline segments are available to verify.',
    });
    return;
  }

  for (let index = 0; index < segments.length - 1; index += 1) {
    const current = segments[index]!;
    const next = segments[index + 1]!;
    const currentEndMs = current.timelineStartMs + current.durationMs;
    const gapMs = next.timelineStartMs - currentEndMs;
    if (Math.abs(gapMs) <= FRAME_TOLERANCE_MS) continue;
    failures.push({
      code: gapMs > 0 ? 'visual-cut-gap' : 'visual-cut-overlap',
      message:
        gapMs > 0
          ? `Visual cut has a ${gapMs}ms gap.`
          : `Visual cut overlaps by ${Math.abs(gapMs)}ms.`,
      boundaryMs: currentEndMs,
      gapMs,
      sceneId: current.sceneId,
    });
  }
}

function addCaptionBoundaryFailures(
  project: VideoProject,
  edl: EditDecisionList,
  failures: Array<Record<string, unknown>>,
): void {
  const segmentsByScene = new Map(
    edl.segments
      .filter((segment) => segment.sceneId)
      .map((segment) => [segment.sceneId!, segment]),
  );

  for (const scene of project.storyboard?.scenes ?? []) {
    if (!scene.caption?.text) continue;
    const segment = segmentsByScene.get(scene.id);
    const captions = edl.captions.filter(
      (caption) => caption.sceneId === scene.id,
    );
    if (!segment) {
      failures.push({
        code: 'scene-segment-missing',
        message: `Scene ${scene.id} has no visual segment.`,
        sceneId: scene.id,
      });
      continue;
    }
    if (captions.length === 0) {
      failures.push({
        code: 'caption-missing',
        message: `Scene ${scene.id} has no caption in the EDL.`,
        sceneId: scene.id,
      });
      continue;
    }

    const sceneStartMs = segment.timelineStartMs;
    const sceneEndMs = segment.timelineStartMs + segment.durationMs;
    for (const caption of captions) {
      if (
        caption.startMs >= sceneStartMs - FRAME_TOLERANCE_MS &&
        caption.endMs <= sceneEndMs + FRAME_TOLERANCE_MS
      ) {
        continue;
      }
      failures.push({
        code: 'caption-out-of-scene',
        message: `Caption ${caption.clipId} crosses the scene boundary.`,
        sceneId: scene.id,
        captionId: caption.id,
        startMs: caption.startMs,
        endMs: caption.endMs,
        sceneStartMs,
        sceneEndMs,
      });
    }
  }
}

function addAudioFadeFailures(
  edl: EditDecisionList,
  failures: Array<Record<string, unknown>>,
): void {
  const boundaries = [...edl.segments]
    .sort(
      (a, b) =>
        a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id),
    )
    .slice(0, -1)
    .map((segment) => segment.timelineStartMs + segment.durationMs);

  for (const boundaryMs of boundaries) {
    for (const track of edl.audioTracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (!clip.sceneId) continue;
        const clipEndMs = clip.timelineStartMs + clip.durationMs;
        if (
          Math.abs(clipEndMs - boundaryMs) <= FRAME_TOLERANCE_MS &&
          (clip.fadeOutMs ?? 0) < AUDIO_CUT_FADE_MS
        ) {
          failures.push({
            code: 'audio-fade-out-missing',
            message: `Audio clip ${clip.clipId} needs at least ${AUDIO_CUT_FADE_MS}ms fade-out at the cut.`,
            sceneId: clip.sceneId,
            clipId: clip.clipId,
            boundaryMs,
            fadeOutMs: clip.fadeOutMs ?? 0,
          });
        }
        if (
          Math.abs(clip.timelineStartMs - boundaryMs) <= FRAME_TOLERANCE_MS &&
          (clip.fadeInMs ?? 0) < AUDIO_CUT_FADE_MS
        ) {
          failures.push({
            code: 'audio-fade-in-missing',
            message: `Audio clip ${clip.clipId} needs at least ${AUDIO_CUT_FADE_MS}ms fade-in at the cut.`,
            sceneId: clip.sceneId,
            clipId: clip.clipId,
            boundaryMs,
            fadeInMs: clip.fadeInMs ?? 0,
          });
        }
      }
    }
  }
}

function expectedProjectTranscript(project: VideoProject): string {
  const narration = project.storyboard?.narration?.segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
  if (narration) return narration;

  const captions = project.storyboard?.scenes
    .map((scene) => scene.caption?.text.trim())
    .filter((text): text is string => Boolean(text))
    .join(' ');
  if (captions) return captions;

  return (project.script ?? project.prompt ?? '').trim();
}

function renderedTranscriptHypothesis(edl: EditDecisionList): string {
  const audioTranscript = edl.audioTracks
    .flatMap((track) => track.clips)
    .map((clip) => clip.transcriptText?.trim())
    .filter((text): text is string => Boolean(text))
    .join(' ');
  if (audioTranscript) return audioTranscript;

  return edl.captions
    .map((caption) => caption.text.trim())
    .filter(Boolean)
    .join(' ');
}

function normalizePatchedProject(
  project: VideoProject,
  diff: ProjectDiffOperation[],
): VideoProject {
  const storyboardChanged = diff.some((operation) =>
    operation.path.startsWith('/storyboard'),
  );
  return storyboardChanged ? rebuildTimelineFromStoryboard(project) : project;
}

function requireStoryboard(project: VideoProject): Storyboard {
  if (!project.storyboard) throw new Error('Storyboard required');
  return project.storyboard;
}

function editableTimeline(project: VideoProject): VideoTimeline {
  if (project.timeline) return project.timeline;
  const timeline = rebuildTimelineFromStoryboard(project).timeline;
  if (!timeline) throw new Error('Timeline required');
  return timeline;
}

function replaceTimelineDiff(
  project: VideoProject,
  timeline: VideoTimeline,
): ProjectDiffOperation[] {
  return upsertDiff(project, '/timeline', timeline);
}

export function buildTimelineEditToolOps(
  project: VideoProject,
  call: TimelineEditAgentToolCall,
): EditBuildResult {
  const timeline = editableTimeline(project);
  switch (call.name) {
    case 'cutClip':
      return buildCutClipOps(timeline, call.args);
    case 'cutRange':
      return buildCutRangeOps(timeline, call.args);
    case 'duplicateClips':
      return buildDuplicateClipsOps(timeline, call.args);
    case 'deleteClips':
      return buildDeleteClipsOps(timeline, call.args);
    case 'moveClips':
      return mergeEditBuildResults(
        dedupeLinkedMoves(timeline, call.args.moves, call.args.linkPolicy).map(
          (move) =>
            buildMoveClipOps(timeline, {
              ...move,
              magnetic: call.args.magnetic,
              linkPolicy: call.args.linkPolicy,
            }),
        ),
      );
    case 'setClipSpeed':
      return buildSetClipSpeedOps(timeline, call.args);
    case 'reverseClip':
      return buildReverseClipOps(timeline, call.args);
    case 'rotateClip':
      return buildRotateClipOps(timeline, call.args);
    case 'flipClip':
      return buildFlipClipOps(timeline, call.args);
    case 'setClipTransform':
      return buildSetClipTransformOps(timeline, call.args);
    case 'closeGap':
      return buildCloseGapOps(timeline, call.args);
    case 'setAudioClipGain':
      return buildSetAudioClipGainOps(timeline, call.args);
    case 'setAudioClipMute':
      return buildSetAudioClipMuteOps(timeline, call.args);
    case 'setAudioClipFade':
      return buildSetAudioClipFadeOps(timeline, call.args);
    case 'setAudioTrackVolume':
      return buildSetAudioTrackVolumeOps(timeline, call.args);
    case 'setAudioTrackMute':
      return buildSetAudioTrackMuteOps(timeline, call.args);
    case 'setAudioTransition':
      return buildSetAudioTransitionOps(timeline, call.args);
    case 'crossfadeAudioClips':
      return buildCrossfadeAudioClipsOps(timeline, call.args);
    case 'setAudioVolumeKeyframes':
      return buildSetAudioVolumeKeyframesOps(timeline, call.args);
    case 'replaceAudioClipSource':
      return buildReplaceAudioClipSourceOps(timeline, call.args);
    case 'duckAudio':
      return buildDuckAudioOps(timeline, {
        trackId: call.args.trackId,
        duckUnderTrackId: call.args.underTrackId,
        volumeDb: call.args.attenuationDb,
      });
    case 'setOverlayControls': {
      const resolved = resolveOverlayPresetForClip(timeline, call.args.clipId);
      return buildSetVividOverlayControlsOps(timeline, {
        clipId: call.args.clipId,
        controls: call.args.controls
          ? normalizeOverlayControlValues(
              call.args.controls,
              resolved?.controls,
            )
          : undefined,
        loop: call.args.loop,
        controlDefs: resolved?.controls,
      });
    }
    case 'setOverlayControlKeyframes': {
      const resolved = resolveOverlayPresetForClip(timeline, call.args.clipId);
      return buildSetVividOverlayControlKeyframesOps(timeline, {
        clipId: call.args.clipId,
        controlId: call.args.controlId,
        keys: call.args.keys,
        controlDefs: resolved?.controls,
      });
    }
    case 'applyOverlayMotionTemplate': {
      const resolved = resolveOverlayPresetForClip(timeline, call.args.clipId);
      return buildApplyVividOverlayMotionTemplateOps(timeline, {
        clipId: call.args.clipId,
        templateId: call.args.templateId,
        strength: call.args.strength,
        category: resolved?.category,
      });
    }
    case 'setClipParams':
      return buildSetClipParamsOps(timeline, call.args);
    default: {
      const exhaustive: never = call;
      return exhaustive;
    }
  }
}

/**
 * Resolve the registry preset for a vivid overlay clip so its control defs
 * can validate agent-supplied values. Unknown presets (e.g. removed plugin
 * packs) return undefined — the builder then applies without def validation,
 * matching the inspector's permissive rendering of unknown presets.
 */
function resolveOverlayPresetForClip(
  timeline: VideoTimeline,
  clipId: string,
): VividOverlayPresetDef | undefined {
  const location = findTimelineClip(timeline.tracks, clipId);
  if (!location || !isVividOverlayClip(location.clip)) return undefined;
  const params = parseVividOverlayParams(location.clip.params);
  if (!params) return undefined;
  return findVividOverlayPreset(params.presetId);
}

/** Normalize color-typed control values ("green", rgb()) to inspector-editable hex. */
function normalizeOverlayControlValues(
  controls: Record<string, string | number | boolean>,
  defs: readonly VividOverlayControlDef[] | undefined,
): Record<string, string | number | boolean> {
  if (!defs) return controls;
  const byId = new Map(defs.map((def) => [def.id, def]));
  return Object.fromEntries(
    Object.entries(controls).map(([id, value]) => [
      id,
      byId.get(id)?.type === 'color' && typeof value === 'string'
        ? normalizeCssColor(value)
        : value,
    ]),
  );
}

function dedupeLinkedMoves(
  timeline: VideoTimeline,
  moves: MoveClipToolMove[],
  linkPolicy: 'linked' | 'primary-only' | undefined,
): MoveClipToolMove[] {
  if (linkPolicy === 'primary-only') return moves;
  const seen = new Map<string, MoveClipToolMove>();
  const result: MoveClipToolMove[] = [];
  for (const move of moves) {
    const location = findTimelineClip(timeline.tracks, move.clipId);
    const key = location?.clip.linkGroupId
      ? `link:${location.clip.linkGroupId}`
      : `clip:${move.clipId}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, move);
      result.push(move);
      continue;
    }
    if (
      existing.toFrame !== move.toFrame ||
      existing.toTrackId !== move.toTrackId
    ) {
      throw new Error(
        'Linked clips must be moved once per link group with one destination',
      );
    }
  }
  return result;
}

function highLevelTimelineEditDiff(
  project: VideoProject,
  call: TimelineEditAgentToolCall,
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const build = buildTimelineEditToolOps(project, call);
  return applyTimelineOpsDiff(
    project,
    {
      ops: build.ops,
      summary: call.args.summary ?? timelineEditSummary(call),
    },
    options,
  );
}

function mergeEditBuildResults(results: EditBuildResult[]): EditBuildResult {
  return {
    ops: results.flatMap((result) => result.ops),
    conflicts: results.flatMap((result) => result.conflicts),
    metadata: mergeEditBuildMetadata(results.map((result) => result.metadata)),
  };
}

function mergeEditBuildMetadata(
  metadata: EditBuildMetadata[],
): EditBuildMetadata {
  const ranges = metadata
    .map((item) => item.affectedRange)
    .filter((range): range is NonNullable<typeof range> => Boolean(range));
  return {
    ...(ranges.length > 0
      ? {
          affectedRange: {
            startFrame: Math.min(...ranges.map((range) => range.startFrame)),
            endFrame: Math.max(...ranges.map((range) => range.endFrame)),
          },
        }
      : {}),
    affectedTrackIds: uniqueStrings(
      metadata.flatMap((item) => item.affectedTrackIds),
    ),
    changedClipIds: uniqueStrings(
      metadata.flatMap((item) => item.changedClipIds),
    ),
    createdClipIds: uniqueStrings(
      metadata.flatMap((item) => item.createdClipIds),
    ),
    removedClipIds: uniqueStrings(
      metadata.flatMap((item) => item.removedClipIds),
    ),
    shiftedClipIds: uniqueStrings(
      metadata.flatMap((item) => item.shiftedClipIds),
    ),
    inspectClipIds: uniqueStrings(
      metadata.flatMap((item) => item.inspectClipIds),
    ),
  };
}

function timelineEditSummary(call: TimelineEditAgentToolCall): string {
  return `${call.name} (${call.args.summary ?? 'timeline edit'})`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function applyTimelineOpDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'applyTimelineOp' }>['args'],
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const execution = applyTimelineOpToProject(project, {
    op: args.op,
    source: 'agent',
    summary: args.summary,
    now: options.now,
    journalId: options.journalId,
  });
  return [
    // Keep generated captions aligned to their speech after the edit.
    ...upsertDiff(
      project,
      '/timeline',
      retimeTimelineCaptions(execution.timeline),
    ),
    ...upsertDiff(project, '/history', execution.project.history),
    ...acceptedAssetProvenanceDiff(project, [args.op], execution.entry.id),
  ];
}

function applyTimelineOpsDiff(
  project: VideoProject,
  args: Extract<VideoAgentToolCall, { name: 'applyTimelineOps' }>['args'],
  options: VideoAgentToolOptions,
): ProjectDiffOperation[] {
  const execution = applyTimelineOpsToProject(project, {
    ops: args.ops,
    source: 'agent',
    summary: args.summary,
    now: options.now,
    journalId: options.journalId,
  });
  return [
    // Keep generated captions aligned to their speech after clips move/trim.
    ...upsertDiff(
      project,
      '/timeline',
      retimeTimelineCaptions(execution.timeline),
    ),
    ...upsertDiff(project, '/history', execution.project.history),
    ...acceptedAssetProvenanceDiff(project, args.ops, execution.entry.id),
  ];
}

function acceptedTimelineOpId(project: VideoProject): string | undefined {
  const history = project.history;
  if (!history || history.head <= 0) return undefined;
  return history.entries[history.head - 1]?.id;
}

function acceptedAssetProvenanceDiff(
  project: VideoProject,
  ops: TimelineOp[],
  acceptedOpId: string,
): ProjectDiffOperation[] {
  const assetIds = collectTimelineOpAssetIds(ops);
  if (assetIds.size === 0) return [];
  return project.assets.flatMap((asset, index) => {
    if (!assetIds.has(asset.id) || !asset.provenance) return [];
    return [
      {
        op: 'replace',
        path: `/assets/${index}`,
        value: {
          ...asset,
          provenance: {
            ...asset.provenance,
            acceptedOpId,
          },
        },
      } satisfies ProjectDiffOperation,
    ];
  });
}

function collectTimelineOpAssetIds(ops: TimelineOp[]): Set<string> {
  const assetIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const sourceRef = record.sourceRef;
    if (sourceRef && typeof sourceRef === 'object') {
      const ref = sourceRef as Record<string, unknown>;
      if (ref.kind === 'asset' && typeof ref.assetId === 'string') {
        assetIds.add(ref.assetId);
      }
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(ops);
  return assetIds;
}

function sceneIndex(storyboard: Storyboard, sceneId: string): number {
  const index = storyboard.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new Error(`Scene not found: ${sceneId}`);
  return index;
}

function sceneAt(storyboard: Storyboard, index: number): StoryboardScene {
  return requireArrayItem(storyboard.scenes, index, 'Scene');
}

function requireArrayItem<T>(items: T[], index: number, label: string): T {
  const item = items[index];
  if (!item) throw new Error(`${label} not found at index ${index}`);
  return item;
}

function upsertDiff(
  project: VideoProject,
  path: string,
  value: unknown,
): ProjectDiffOperation[] {
  return [
    {
      op: hasAt(project, path) ? 'replace' : 'add',
      path,
      value,
    },
  ];
}

function insertIntoArray<T>(items: T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function applyOperation(
  document: VideoProject,
  operation: ProjectDiffOperation,
): void {
  switch (operation.op) {
    case 'add':
      addAt(document, operation.path, clone(operation.value));
      return;
    case 'remove':
      removeAt(document, operation.path);
      return;
    case 'replace':
      replaceAt(document, operation.path, clone(operation.value));
      return;
    case 'test':
      if (
        JSON.stringify(readAt(document, operation.path)) !==
        JSON.stringify(operation.value)
      ) {
        throw new Error(`JSON Patch test failed at ${operation.path}`);
      }
      return;
    default:
      throw new Error(`Unsupported JSON Patch operation: ${operation.op}`);
  }
}

function readAt(document: unknown, path: string): unknown {
  const tokens = parsePointer(path);
  let current = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      current = current[parseArrayIndex(token, current.length, false)];
      continue;
    }
    if (isRecord(current)) {
      current = current[token];
      continue;
    }
    throw new Error(`Cannot read JSON Pointer ${path}`);
  }
  return current;
}

function hasAt(document: unknown, path: string): boolean {
  if (path === '') return true;
  try {
    const { parent, key } = parentAt(document, path);
    if (Array.isArray(parent)) {
      parseArrayIndex(key, parent.length, false);
      return true;
    }
    return key in parent;
  } catch {
    return false;
  }
}

function addAt(document: unknown, path: string, value: unknown): void {
  const { parent, key } = parentAt(document, path);
  if (Array.isArray(parent)) {
    parent.splice(parseArrayIndex(key, parent.length, true), 0, value);
    return;
  }
  parent[key] = value;
}

function removeAt(document: unknown, path: string): void {
  const { parent, key } = parentAt(document, path);
  if (Array.isArray(parent)) {
    parent.splice(parseArrayIndex(key, parent.length, false), 1);
    return;
  }
  if (!(key in parent)) throw new Error(`Cannot remove missing path ${path}`);
  delete parent[key];
}

function replaceAt(document: unknown, path: string, value: unknown): void {
  const { parent, key } = parentAt(document, path);
  if (Array.isArray(parent)) {
    parent[parseArrayIndex(key, parent.length, false)] = value;
    return;
  }
  if (!(key in parent)) throw new Error(`Cannot replace missing path ${path}`);
  parent[key] = value;
}

function parentAt(
  document: unknown,
  path: string,
): { parent: JsonContainer; key: string } {
  const tokens = parsePointer(path);
  if (tokens.length === 0) {
    throw new Error('Root-level patch operations are not supported');
  }
  const key = tokens[tokens.length - 1];
  if (key === undefined) throw new Error(`Invalid JSON Pointer: ${path}`);
  let parent = document;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(parent)) {
      parent = parent[parseArrayIndex(token, parent.length, false)];
    } else if (isRecord(parent)) {
      parent = parent[token];
    } else {
      throw new Error(`Cannot traverse JSON Pointer ${path}`);
    }
  }
  if (!Array.isArray(parent) && !isRecord(parent)) {
    throw new Error(`Invalid JSON Pointer parent for ${path}`);
  }
  return { parent, key };
}

function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${path}`);
  return path
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function parseArrayIndex(
  token: string,
  length: number,
  allowEnd: boolean,
): number {
  if (token === '-' && allowEnd) return length;
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new Error(`Invalid array index: ${token}`);
  }
  const index = Number(token);
  const max = allowEnd ? length : length - 1;
  if (index < 0 || index > max) {
    throw new Error(`Array index out of bounds: ${token}`);
  }
  return index;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
