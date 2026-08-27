import {
  audioEnvelopeGainAtFrame,
  bookendAudioGainAtFrame,
  bookendOverlayOpacity,
  findKeyframeTrack,
  localFrameToSourceFrame,
  normalizeClipPlayback,
  resolveTimelineProperty,
} from '@neumar/video-ir';
import type { KeyframeableProperty } from '@neumar/video-ir';
import { Video as MediaVideo, type VideoObjectFit } from '@remotion/media';
import { TransitionSeries } from '@remotion/transitions';
import React, { type CSSProperties } from 'react';
import {
  AbsoluteFill,
  Composition,
  Freeze,
  Html5Audio,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import type { CalculateMetadataFunction, EffectsProp } from 'remotion';
import { Sequence } from 'remotion';

import {
  DEFAULT_CAPTION_ACCENT,
  isAnimatedCaptionStyle,
  resolveCaptionWords,
} from './caption-word-render';
import { buildClipCssFilter } from './clip-filters';
import { buildRemotionClipEffects } from './remotion-clip-effects';
import {
  REMOTION_OVERLAY_PASS_COMPOSITION_ID,
  REMOTION_RENDER_COMPOSITION_ID,
} from './remotion-constants';
import type {
  RemotionRenderAudioClip,
  RemotionRenderCaption,
  RemotionRenderInput,
  RemotionRenderVisualClip,
} from './remotion-render-input';
import {
  transitionFramesForClip,
  transitionPresentation,
  transitionTiming,
} from './remotion-transition-presentations';
import { VividOverlayLayerNodes } from './remotion-vivid-overlay';

type RemotionCompositionProps = RemotionRenderInput & Record<string, unknown>;
type TypedCompositionProps = {
  id: string;
  component: React.ComponentType<RemotionCompositionProps>;
  defaultProps: RemotionCompositionProps;
  calculateMetadata: CalculateMetadataFunction<RemotionCompositionProps>;
};

// Re-export so external callers that imported the ID from this module
// keep working — the constant moved to its own leaf file to break the
// sidecar bundle's dependency on the full Remotion composition tree.
export { REMOTION_RENDER_COMPOSITION_ID } from './remotion-constants';

const DEFAULT_RENDER_INPUT: RemotionCompositionProps = {
  schema: 'neuma.video.remotion-input.v1',
  projectId: 'preview',
  aspectRatio: '16:9',
  compositionWidth: 1280,
  compositionHeight: 720,
  durationInFrames: 1,
  fps: 30,
  visualClips: [],
  audioClips: [],
  captions: [],
  useRemotionMedia: true,
};
const NO_EFFECTS: EffectsProp = [];
const calculateMetadata: CalculateMetadataFunction<
  RemotionCompositionProps
> = ({ props }) => ({
  width: props.compositionWidth,
  height: props.compositionHeight,
  fps: props.fps,
  durationInFrames: props.durationInFrames,
});

export function RemotionRenderRoot() {
  const TypedComposition =
    Composition as unknown as React.ComponentType<TypedCompositionProps>;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(TypedComposition, {
      id: REMOTION_RENDER_COMPOSITION_ID,
      component: RemotionRenderComposition,
      defaultProps: DEFAULT_RENDER_INPUT,
      calculateMetadata,
    }),
    // Overlay pass: vivid overlays alone on a transparent background,
    // rendered to an alpha codec and composited over the base video by the
    // ffmpeg burn step (pipeline overlay pass). Same input props shape.
    React.createElement(TypedComposition, {
      id: REMOTION_OVERLAY_PASS_COMPOSITION_ID,
      component: VividOverlayPassComposition,
      defaultProps: DEFAULT_RENDER_INPUT,
      calculateMetadata,
    }),
  );
}

export function VividOverlayPassComposition(
  props: RemotionCompositionProps,
): React.ReactElement {
  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: 'transparent' } },
    ...VividOverlayLayerNodes({
      entries: props.vividOverlays ?? [],
      fps: props.fps,
      width: props.compositionWidth,
      height: props.compositionHeight,
    }),
  );
}

export function RemotionRenderComposition(
  props: RemotionCompositionProps,
): React.ReactElement {
  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: '#000000' } },
    ...visualTrackNodes(
      props.visualClips,
      props.fps,
      {
        width: props.compositionWidth,
        height: props.compositionHeight,
      },
      props.useRemotionMedia ?? true,
    ),
    ...props.audioClips.map((clip) =>
      React.createElement(
        Sequence,
        {
          key: clip.id,
          from: clip.fromFrame,
          durationInFrames: clip.durationInFrames,
        },
        React.createElement(AudioClip, {
          clip,
          fps: props.fps,
          compositionDurationInFrames: props.durationInFrames,
          introFrames: props.introFrames,
          outroFrames: props.outroFrames,
        }),
      ),
    ),
    // Vivid overlays render below captions — captions stay the last overlay
    // step (pipeline hard rule).
    ...VividOverlayLayerNodes({
      entries: props.vividOverlays ?? [],
      fps: props.fps,
      width: props.compositionWidth,
      height: props.compositionHeight,
    }),
    ...props.captions.map((caption) =>
      React.createElement(
        Sequence,
        {
          key: caption.id,
          from: caption.fromFrame,
          durationInFrames: caption.durationInFrames,
        },
        React.createElement(Caption, { caption, fps: props.fps }),
      ),
    ),
    React.createElement(BookendFadeOverlay, {
      durationInFrames: props.durationInFrames,
      introFrames: props.introFrames,
      outroFrames: props.outroFrames,
    }),
  );
}

type KenBurnsRect = { x: number; y: number; width: number; height: number };

// Mirrors frontend KenBurnsImage / FFmpeg zoompan: zoom = max(1/w, 1/h)
// clamped [1,10], centered on the rect, eased from `from` to `to`.
function KenBurnsImage({
  src,
  kenBurns,
  durationInFrames,
  mediaStyle,
  effects,
}: {
  src: string;
  kenBurns: { from: KenBurnsRect; to: KenBurnsRect };
  durationInFrames: number;
  mediaStyle: CSSProperties;
  effects?: EffectsProp;
}): React.ReactElement {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const from = normalizeKenBurnsRect(kenBurns.from);
  const to = normalizeKenBurnsRect(kenBurns.to);
  const zoom = lerp(rectZoom(from), rectZoom(to), progress);
  const cx = lerp(from.x + from.width / 2, to.x + to.width / 2, progress);
  const cy = lerp(from.y + from.height / 2, to.y + to.height / 2, progress);
  return React.createElement(Img, {
    src,
    style: {
      ...mediaStyle,
      transformOrigin: `${cx * 100}% ${cy * 100}%`,
      transform: `translate(${(0.5 - cx) * 100}%, ${(0.5 - cy) * 100}%) scale(${zoom})`,
    },
    effects,
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeKenBurnsRect(rect: KenBurnsRect): KenBurnsRect {
  const width = Math.min(1, Math.max(0.05, rect.width));
  const height = Math.min(1, Math.max(0.05, rect.height));
  return {
    x: Math.min(1 - width, Math.max(0, rect.x)),
    y: Math.min(1 - height, Math.max(0, rect.y)),
    width,
    height,
  };
}

function rectZoom(rect: Pick<KenBurnsRect, 'width' | 'height'>): number {
  return Math.min(10, Math.max(1, Math.max(1 / rect.width, 1 / rect.height)));
}

function VisualClip({
  clip,
  transitionTailFrames,
  fps,
  useRemotionMedia,
}: {
  clip: RemotionRenderVisualClip;
  transitionTailFrames: number;
  fps: number;
  useRemotionMedia: boolean;
}) {
  const frame = useCurrentFrame();
  const localMs = frameToMs(frame, fps);
  const style = transformStyle(clip, localMs);
  const effects = buildRemotionClipEffects(clip.effects, localMs);
  const blurPad = clip.transforms?.fit === 'blur-pad';
  const trimBefore = clip.sourceStartFrame;
  const trimAfter = sourceEndFrameWithTail(clip, transitionTailFrames);
  const playback = normalizeClipPlayback(clip.playback);
  const playbackProps = playback.reverse
    ? {}
    : {
        playbackRate: playback.speed,
        preservePitch: playback.pitchCorrection !== false,
      };
  if (clip.mediaKind === 'image') {
    if (blurPad) {
      const { bg, fg } = blurPadStyles(clip, localMs);
      return React.createElement(
        AbsoluteFill,
        { style },
        React.createElement(Img, { src: clip.src, style: bg, effects }),
        React.createElement(Img, { src: clip.src, style: fg, effects }),
      );
    }
    const kenBurns = clip.imagePan?.kenBurns;
    return React.createElement(
      AbsoluteFill,
      { style },
      kenBurns
        ? React.createElement(KenBurnsImage, {
            src: clip.src,
            kenBurns,
            durationInFrames: clip.durationInFrames + transitionTailFrames,
            mediaStyle: mediaElementStyle(clip, localMs),
            effects,
          })
        : React.createElement(Img, {
            src: clip.src,
            style: mediaElementStyle(clip, localMs),
            effects,
          }),
    );
  }

  const muted = (clip.muted ?? false) || playback.reverse;
  const reverseFrame = playback.reverse
    ? localFrameToSourceFrame(frame, {
        playback,
        trimEndFrame: trimAfter,
        trimStartFrame: trimBefore,
      }) - trimBefore
    : null;
  const content =
    clip.transforms?.fit === 'blur-pad'
      ? (() => {
          const { bg, fg } = blurPadStyles(clip, localMs);
          return React.createElement(
            React.Fragment,
            null,
            React.createElement(RenderVideo, {
              src: clip.src,
              style: bg,
              muted: true,
              trimBefore,
              trimAfter,
              useRemotionMedia,
              effects,
              ...playbackProps,
            }),
            React.createElement(RenderVideo, {
              src: clip.src,
              style: fg,
              muted,
              trimBefore,
              trimAfter,
              useRemotionMedia,
              effects,
              ...playbackProps,
            }),
          );
        })()
      : React.createElement(RenderVideo, {
          src: clip.src,
          style: mediaElementStyle(clip, localMs),
          muted,
          trimBefore,
          trimAfter,
          useRemotionMedia,
          effects,
          ...playbackProps,
        });

  if (blurPad) {
    return React.createElement(
      AbsoluteFill,
      { style },
      reverseFrame === null
        ? content
        : React.createElement(Freeze, {
            children: content,
            frame: reverseFrame,
          }),
    );
  }

  return React.createElement(
    AbsoluteFill,
    { style },
    reverseFrame === null
      ? content
      : React.createElement(Freeze, {
          children: content,
          frame: reverseFrame,
        }),
  );
}

interface RenderVideoProps {
  src: string;
  muted: boolean;
  trimBefore: number;
  trimAfter: number;
  playbackRate?: number;
  preservePitch?: boolean;
  style?: CSSProperties;
  useRemotionMedia: boolean;
  effects?: EffectsProp;
}

/** Selects the new renderer or the legacy rollback path per render input. */
function RenderVideo({
  src,
  muted,
  trimBefore,
  trimAfter,
  playbackRate,
  preservePitch,
  style,
  useRemotionMedia,
  effects = NO_EFFECTS,
}: RenderVideoProps): React.ReactElement {
  if (!useRemotionMedia) {
    if (effects.length > 0) {
      throw new UnsupportedMediaEffectError();
    }
    return React.createElement(OffthreadVideo, {
      src,
      muted,
      trimBefore,
      trimAfter,
      playbackRate,
      preservePitch,
      style,
    });
  }

  const { objectFit, ...canvasStyle } = style ?? {};
  return React.createElement(MediaVideo, {
    src,
    muted,
    trimBefore,
    trimAfter,
    playbackRate,
    objectFit: toMediaObjectFit(objectFit),
    style: canvasStyle,
    disallowFallbackToOffthreadVideo: effects.length > 0,
    effects,
    fallbackOffthreadVideoProps: { preservePitch },
  });
}

export class UnsupportedMediaEffectError extends Error {
  readonly code = 'unsupported_media_effect_renderer';

  constructor() {
    super('Clip effects require the @remotion/media canvas renderer');
    this.name = 'UnsupportedMediaEffectError';
  }
}

function toMediaObjectFit(
  objectFit: CSSProperties['objectFit'],
): VideoObjectFit | undefined {
  switch (objectFit) {
    case 'fill':
    case 'contain':
    case 'cover':
    case 'none':
    case 'scale-down':
      return objectFit;
    default:
      return undefined;
  }
}

// blur-pad: whole media (contain) over a blurred, zoomed cover copy. Mirrors the
// FFmpeg blur-pad filter and the frontend RemotionBlurPad preview.
function blurPadStyles(
  clip: RemotionRenderVisualClip,
  localMs: number,
): {
  bg: CSSProperties;
  fg: CSSProperties;
} {
  const base = mediaElementStyle(clip, localMs);
  const baseFilter = typeof base.filter === 'string' ? `${base.filter} ` : '';
  return {
    bg: {
      ...base,
      inset: 0,
      objectFit: 'cover',
      filter: `${baseFilter}blur(28px)`,
      position: 'absolute',
      transform: 'scale(1.12)',
      zIndex: 0,
    },
    fg: {
      ...base,
      inset: 0,
      objectFit: 'contain',
      objectPosition: 'center',
      position: 'absolute',
      zIndex: 1,
    },
  };
}

function AudioClip({
  clip,
  fps,
  compositionDurationInFrames,
  introFrames,
  outroFrames,
}: {
  clip: RemotionRenderAudioClip;
  fps: number;
  compositionDurationInFrames: number;
  introFrames?: number;
  outroFrames?: number;
}) {
  const playback = normalizeClipPlayback(clip.playback);
  if (playback.reverse) return null;
  return React.createElement(Html5Audio, {
    src: clip.src,
    playbackRate: playback.speed,
    preservePitch: playback.pitchCorrection !== false,
    volume: (frame: number) => {
      const absoluteFrame = clip.fromFrame + frame;
      return (
        legacyAudioVolumeFallback(clip) *
        audioEnvelopeGainAtFrame({
          absoluteFrame,
          bookendGain: bookendAudioGainAtFrame({
            absoluteFrame,
            compositionDurationInFrames,
            introFrames,
            outroFrames,
          }),
          clipGainDb: clip.gainDb,
          clipMuted: clip.muted,
          durationInFrames: clip.durationInFrames,
          fadeInCurve: clip.fadeInCurve,
          fadeInFrames: clip.fadeInFrames,
          fadeOutCurve: clip.fadeOutCurve,
          fadeOutFrames: clip.fadeOutFrames,
          fps,
          keyframes: clip.keyframes,
          localFrame: frame,
          trackMuted: clip.trackMuted,
          trackVolumeDb: clip.trackVolumeDb,
        })
      );
    },
    trimBefore: clip.sourceStartFrame,
    trimAfter: clip.sourceEndFrame,
  });
}

function legacyAudioVolumeFallback(clip: RemotionRenderAudioClip): number {
  // Keep in sync with frontend RemotionTimelineAudio and WebCodecs AudioEngine
  // until legacy `volume` payloads are fully migrated to gainDb/keyframes.
  return clip.gainDb === undefined &&
    clip.trackVolumeDb === undefined &&
    !clip.keyframes
    ? clip.volume
    : 1;
}

function BookendFadeOverlay({
  durationInFrames,
  introFrames,
  outroFrames,
}: {
  durationInFrames: number;
  introFrames?: number;
  outroFrames?: number;
}) {
  const frame = useCurrentFrame();
  const opacity = bookendOverlayOpacity({
    absoluteFrame: frame,
    compositionDurationInFrames: durationInFrames,
    introFrames,
    outroFrames,
  });
  if (opacity <= 0) return null;
  return React.createElement(AbsoluteFill, {
    style: { backgroundColor: '#000000', opacity },
  });
}

function Caption({
  caption,
  fps,
}: {
  caption: RemotionRenderCaption;
  fps: number;
}) {
  // Position via normalized coords so the rendered output matches the
  // on-canvas editor overlay exactly. Legacy clips that only carry a
  // `position` string still render by deriving a normalized y here.
  const defaultY =
    caption.position === 'top'
      ? 0.1
      : caption.position === 'middle'
        ? 0.5
        : 0.85;
  const cx = Math.max(0, Math.min(1, caption.style?.positionX ?? 0.5));
  const cy = Math.max(0, Math.min(1, caption.style?.positionY ?? defaultY));
  const maxWidth = Math.max(0.05, Math.min(1, caption.style?.maxWidth ?? 0.8));
  const frame = useCurrentFrame();
  const localMs = frameToMs(frame, fps);
  const opacity =
    captionFadeOpacity(
      frame,
      caption.durationInFrames,
      caption.entranceFrames ?? 0,
      caption.exitFrames ?? 0,
    ) * resolveTimelineProperty(caption, 'textOpacity', localMs);
  const textScale = resolveTimelineProperty(caption, 'textScale', localMs);
  const strokeStyle =
    caption.style?.strokeColor &&
    caption.style?.strokeWidth &&
    caption.style.strokeWidth > 0
      ? {
          WebkitTextStrokeWidth: `${caption.style.strokeWidth}px`,
          WebkitTextStrokeColor: caption.style.strokeColor,
        }
      : {};
  const shadowColor = caption.style?.shadowColor;
  const shadowX = caption.style?.shadowOffsetX ?? 0;
  const shadowY = caption.style?.shadowOffsetY ?? 0;
  const shadowBlur = caption.style?.shadowBlur ?? 0;
  const textShadow =
    shadowColor && (shadowX !== 0 || shadowY !== 0 || shadowBlur !== 0)
      ? `${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowColor}`
      : '0 2px 10px rgba(0, 0, 0, 0.35)';
  return React.createElement(
    AbsoluteFill,
    { style: { pointerEvents: 'none', opacity } },
    React.createElement(
      'div',
      {
        style: {
          position: 'absolute',
          left: `${cx * 100}%`,
          top: `${cy * 100}%`,
          width: `${maxWidth * 100}%`,
          transform: `translateX(-50%) scale(${textScale})`,
          transformOrigin: 'top center',
        },
      },
      React.createElement(
        'span',
        {
          style: {
            display: 'block',
            borderRadius: 4,
            backgroundColor: caption.style?.background ?? 'rgba(0, 0, 0, 0.7)',
            color: caption.style?.color ?? '#ffffff',
            fontFamily: caption.style?.fontFamily ?? 'Arial, sans-serif',
            fontSize: caption.style?.fontSize ?? 44,
            fontWeight: caption.style?.fontWeight ?? 700,
            fontStyle: caption.style?.fontStyle ?? 'normal',
            textDecoration: caption.style?.textDecoration ?? 'none',
            lineHeight: 1.15,
            padding: '10px 18px',
            textAlign: caption.style?.textAlign ?? 'center',
            textShadow,
            ...strokeStyle,
          },
        },
        captionBody(caption, frame),
      ),
    ),
  );
}

/**
 * Renders the caption body: a single string for classic/static styles, or a
 * run of per-word spans (emphasis + progressive reveal) for the animated styles.
 */
function captionBody(
  caption: RemotionRenderCaption,
  frame: number,
): React.ReactNode {
  const words = caption.words;
  const animation = caption.style?.animation;
  if (!words?.length || !isAnimatedCaptionStyle(animation)) {
    return caption.text;
  }
  const baseColor = caption.style?.color ?? '#ffffff';
  const scales = animation === 'hormozi-bold' || animation === 'tiktok-word';
  return resolveCaptionWords(words, frame, animation)
    .filter((word) => word.visible)
    .map((word, index) =>
      React.createElement(
        'span',
        {
          key: index,
          style: {
            display: 'inline-block',
            margin: '0 0.14em',
            color: word.emphasized ? DEFAULT_CAPTION_ACCENT : baseColor,
            transform: word.emphasized && scales ? 'scale(1.12)' : 'scale(1)',
            transformOrigin: 'center',
          },
        },
        word.text,
      ),
    );
}

function captionFadeOpacity(
  frame: number,
  durationFrames: number,
  entranceFrames: number,
  exitFrames: number,
): number {
  const dur = Math.max(1, durationFrames);
  const inF = Math.max(0, Math.min(entranceFrames, dur));
  const outF = Math.max(0, Math.min(exitFrames, dur - inF));
  let opacity = 1;
  if (inF > 0 && frame < inF) opacity = frame / inF;
  if (outF > 0 && frame > dur - outF) {
    opacity = Math.min(opacity, Math.max(0, (dur - frame) / outF));
  }
  return Math.max(0, Math.min(1, opacity));
}

const mediaStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

function mediaElementStyle(
  clip: RemotionRenderVisualClip,
  localMs: number,
): CSSProperties {
  const filter = buildClipCssFilter(clip.filters);
  const objectPosition = objectPositionForReframe(clip.reframe?.anchor);
  const objectFit = objectFitForTransform(clip.transforms?.fit);
  const clipPath = cropClipPath(clip, localMs);
  return filter ||
    objectPosition ||
    clipPath ||
    objectFit !== mediaStyle.objectFit
    ? {
        ...mediaStyle,
        objectFit,
        ...(objectPosition ? { objectPosition } : {}),
        ...(clipPath ? { clipPath } : {}),
        ...(filter ? { filter } : {}),
      }
    : mediaStyle;
}

function objectFitForTransform(
  fit: NonNullable<RemotionRenderVisualClip['transforms']>['fit'] | undefined,
): CSSProperties['objectFit'] {
  if (fit === 'contain') return 'contain';
  if (fit === 'fill') return 'fill';
  return 'cover';
}

function objectPositionForReframe(
  anchor: string | undefined,
): string | undefined {
  if (anchor === 'left') return '0% 50%';
  if (anchor === 'right') return '100% 50%';
  if (anchor === 'top') return '50% 0%';
  if (anchor === 'bottom') return '50% 100%';
  if (anchor === 'top-third') return '50% 33%';
  return undefined;
}

function cropClipPath(
  clip: RemotionRenderVisualClip,
  localMs: number,
): string | undefined {
  const top = resolveTimelineProperty(clip, 'cropTop', localMs);
  const right = resolveTimelineProperty(clip, 'cropRight', localMs);
  const bottom = resolveTimelineProperty(clip, 'cropBottom', localMs);
  const left = resolveTimelineProperty(clip, 'cropLeft', localMs);
  if (top <= 0 && right <= 0 && bottom <= 0 && left <= 0) return undefined;
  return `inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%)`;
}

function transformStyle(
  clip: RemotionRenderVisualClip,
  localMs: number,
): CSSProperties {
  const transform = clip.transforms;
  if (!transform && !clip.keyframes?.length) return {};
  const positionX = resolveTimelineProperty(clip, 'positionX', localMs);
  const positionY = resolveTimelineProperty(clip, 'positionY', localMs);
  const scale = resolveTimelineProperty(clip, 'scale', localMs);
  const scaleX =
    transform?.scaleX != null || hasKeyframeProperty(clip, 'scaleX')
      ? resolveTimelineProperty(clip, 'scaleX', localMs)
      : scale;
  const scaleY =
    transform?.scaleY != null || hasKeyframeProperty(clip, 'scaleY')
      ? resolveTimelineProperty(clip, 'scaleY', localMs)
      : scale;
  return {
    backgroundColor: transform?.background,
    opacity: resolveTimelineProperty(clip, 'opacity', localMs),
    transform: [
      `translate(${(positionX - 0.5) * 100}%, ${(positionY - 0.5) * 100}%)`,
      `scale(${scaleX}, ${scaleY})`,
      `rotate(${resolveTimelineProperty(clip, 'rotation', localMs)}deg)`,
    ].join(' '),
  };
}

function hasKeyframeProperty(
  clip: { keyframes?: RemotionRenderVisualClip['keyframes'] },
  property: KeyframeableProperty,
): boolean {
  return Boolean(findKeyframeTrack(clip.keyframes, property));
}

function visualTrackNodes(
  clips: RemotionRenderVisualClip[],
  fps: number,
  size: { width: number; height: number },
  useRemotionMedia: boolean,
): React.ReactNode[] {
  return groupVisualClipsByTrack(clips, fps).flatMap((track) =>
    track.hasTransitions
      ? [
          transitionTrackNode(
            track.id,
            track.clips,
            fps,
            size,
            useRemotionMedia,
          ),
        ]
      : track.clips.map((clip) =>
          visualClipSequenceNode(clip, fps, useRemotionMedia),
        ),
  );
}

function transitionTrackNode(
  trackId: string,
  clips: RemotionRenderVisualClip[],
  fps: number,
  size: { width: number; height: number },
  useRemotionMedia: boolean,
): React.ReactNode {
  let cursorFrame = 0;
  const children = clips.flatMap((clip, index) => {
    const nextClip = clips[index + 1];
    const transitionFrames = transitionFramesForClip(clip, nextClip, fps);
    const gapFrames = Math.max(0, clip.fromFrame - cursorFrame);
    cursorFrame = clip.fromFrame + clip.durationInFrames;
    const nodes: React.ReactNode[] = [];
    if (gapFrames > 0) {
      nodes.push(
        React.createElement(TransitionSeries.Sequence, {
          key: `${clip.id}-gap`,
          durationInFrames: gapFrames,
        }),
      );
    }
    nodes.push(
      React.createElement(
        TransitionSeries.Sequence,
        {
          key: clip.id,
          durationInFrames: clip.durationInFrames + transitionFrames,
        },
        React.createElement(VisualClip, {
          clip,
          transitionTailFrames: transitionFrames,
          fps,
          useRemotionMedia,
        }),
      ),
    );
    if (transitionFrames > 0) {
      nodes.push(
        React.createElement(TransitionSeries.Transition, {
          key: `${clip.id}-transition`,
          presentation: transitionPresentation(clip.transitionToNext, size),
          timing: transitionTiming(clip.transitionToNext, transitionFrames),
        }),
      );
    }
    return nodes;
  });
  return React.createElement(TransitionSeries, { key: trackId }, ...children);
}

function visualClipSequenceNode(
  clip: RemotionRenderVisualClip,
  fps: number,
  useRemotionMedia: boolean,
): React.ReactNode {
  return React.createElement(
    Sequence,
    {
      key: clip.id,
      from: clip.fromFrame,
      durationInFrames: clip.durationInFrames,
    },
    React.createElement(VisualClip, {
      clip,
      transitionTailFrames: 0,
      fps,
      useRemotionMedia,
    }),
  );
}

function sourceEndFrameWithTail(
  clip: RemotionRenderVisualClip,
  transitionTailFrames: number,
): number {
  return clip.sourceEndFrame + transitionTailFrames;
}

function frameToMs(frame: number, fps: number): number {
  return Math.max(0, (Math.max(0, frame) / Math.max(1, fps)) * 1000);
}

function groupVisualClipsByTrack(
  clips: RemotionRenderVisualClip[],
  fps: number,
) {
  const byTrack = new Map<string, RemotionRenderVisualClip[]>();
  for (const clip of clips) {
    byTrack.set(clip.trackId, [...(byTrack.get(clip.trackId) ?? []), clip]);
  }
  return [...byTrack.entries()]
    .map(([id, trackClips]) => {
      const orderedClips = [...trackClips].sort(
        (a, b) => a.fromFrame - b.fromFrame || a.id.localeCompare(b.id),
      );
      return {
        id,
        layer: Math.min(...orderedClips.map((clip) => clip.layer)),
        clips: orderedClips,
        hasTransitions: orderedClips.some(
          (clip, index) =>
            transitionFramesForClip(clip, orderedClips[index + 1], fps) > 0,
        ),
      };
    })
    .sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id));
}
