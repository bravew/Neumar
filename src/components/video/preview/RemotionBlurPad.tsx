import { useMemo, type CSSProperties } from 'react';

import { Video as MediaVideo, type VideoObjectFit } from '@remotion/media';
import { AbsoluteFill, Html5Video, Img, type EffectsProp } from 'remotion';

/**
 * `blur-pad` fit: show the whole media (object-contain) centered over a blurred,
 * zoomed copy of itself that fills the canvas — a branded backdrop instead of
 * black letterbox bars. Used for logos/graphics and aspect mismatches. Mirrors
 * the FFmpeg blur-pad filter graph in pipeline.ts.
 */

const BLUR_RADIUS_PX = 28;
const BG_SCALE = 1.12; // overscan so blurred edges never show canvas
const NO_EFFECTS: EffectsProp = [];

export function blurPadBackgroundStyle(
  mediaStyle: CSSProperties | undefined,
): CSSProperties {
  const baseFilter =
    typeof mediaStyle?.filter === 'string' ? `${mediaStyle.filter} ` : '';
  return {
    inset: 0,
    objectFit: 'cover',
    filter: `${baseFilter}blur(${BLUR_RADIUS_PX}px)`,
    position: 'absolute',
    transform: `scale(${BG_SCALE})`,
    zIndex: 0,
  };
}

export function blurPadForegroundStyle(
  mediaStyle: CSSProperties | undefined,
): CSSProperties {
  return {
    ...mediaStyle,
    inset: 0,
    objectFit: 'contain',
    objectPosition: 'center',
    position: 'absolute',
    zIndex: 1,
  };
}

export function BlurPadImage({
  src,
  mediaStyle,
  effects,
}: {
  src: string;
  mediaStyle: CSSProperties | undefined;
  effects?: EffectsProp;
}) {
  return (
    <AbsoluteFill>
      <Img
        src={src}
        className="size-full"
        style={blurPadBackgroundStyle(mediaStyle)}
        effects={effects}
      />
      <Img
        src={src}
        className="size-full"
        style={blurPadForegroundStyle(mediaStyle)}
        effects={effects}
      />
    </AbsoluteFill>
  );
}

export function BlurPadVideo({
  src,
  muted,
  trimBefore,
  trimAfter,
  mediaStyle,
  playbackRate,
  preservePitch,
  useRemotionMedia,
  effects,
}: {
  src: string;
  muted: boolean;
  trimBefore: number;
  trimAfter: number;
  mediaStyle: CSSProperties | undefined;
  playbackRate?: number;
  preservePitch?: boolean;
  useRemotionMedia: boolean;
  effects?: EffectsProp;
}) {
  return (
    <AbsoluteFill>
      <RemotionVideo
        src={src}
        className="size-full"
        muted
        playbackRate={playbackRate}
        preservePitch={preservePitch}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        style={blurPadBackgroundStyle(mediaStyle)}
        useRemotionMedia={useRemotionMedia}
        effects={effects}
      />
      <RemotionVideo
        src={src}
        className="size-full"
        muted={muted}
        playbackRate={playbackRate}
        preservePitch={preservePitch}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        style={blurPadForegroundStyle(mediaStyle)}
        useRemotionMedia={useRemotionMedia}
        effects={effects}
      />
    </AbsoluteFill>
  );
}

interface RemotionVideoProps {
  src: string;
  className?: string;
  muted: boolean;
  playbackRate?: number;
  preservePitch?: boolean;
  trimBefore: number;
  trimAfter: number;
  style?: CSSProperties;
  useRemotionMedia: boolean;
  effects?: EffectsProp;
}

/** Keeps the legacy renderer reachable while the media migration is observed. */
export function RemotionVideo({
  src,
  className,
  muted,
  playbackRate,
  preservePitch,
  trimBefore,
  trimAfter,
  style,
  useRemotionMedia,
  effects = NO_EFFECTS,
}: RemotionVideoProps) {
  const fallbackOffthreadVideoProps = useMemo(
    () => ({ pauseWhenBuffering: true, preservePitch }),
    [preservePitch],
  );

  if (!useRemotionMedia) {
    if (effects.length > 0) {
      throw new UnsupportedMediaEffectError();
    }
    return (
      <Html5Video
        src={src}
        className={className}
        muted={muted}
        pauseWhenBuffering
        playbackRate={playbackRate}
        preservePitch={preservePitch}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        style={style}
      />
    );
  }

  const { objectFit, ...canvasStyle } = style ?? {};
  return (
    <MediaVideo
      src={src}
      className={className}
      muted={muted}
      playbackRate={playbackRate}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      objectFit={toMediaObjectFit(objectFit)}
      style={canvasStyle}
      disallowFallbackToOffthreadVideo={effects.length > 0}
      effects={effects}
      fallbackOffthreadVideoProps={fallbackOffthreadVideoProps}
    />
  );
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
