import type { CSSProperties } from 'react';

import { AbsoluteFill, Html5Video, Img } from 'remotion';

/**
 * `blur-pad` fit: show the whole media (object-contain) centered over a blurred,
 * zoomed copy of itself that fills the canvas — a branded backdrop instead of
 * black letterbox bars. Used for logos/graphics and aspect mismatches. Mirrors
 * the FFmpeg blur-pad filter graph in pipeline.ts.
 */

const BLUR_RADIUS_PX = 28;
const BG_SCALE = 1.12; // overscan so blurred edges never show canvas

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
}: {
  src: string;
  mediaStyle: CSSProperties | undefined;
}) {
  return (
    <AbsoluteFill>
      <Img
        src={src}
        className="size-full"
        style={blurPadBackgroundStyle(mediaStyle)}
      />
      <Img
        src={src}
        className="size-full"
        style={blurPadForegroundStyle(mediaStyle)}
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
}: {
  src: string;
  muted: boolean;
  trimBefore: number;
  trimAfter: number;
  mediaStyle: CSSProperties | undefined;
  playbackRate?: number;
  preservePitch?: boolean;
}) {
  return (
    <AbsoluteFill>
      <Html5Video
        src={src}
        className="size-full"
        muted
        pauseWhenBuffering
        playbackRate={playbackRate}
        preservePitch={preservePitch}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        style={blurPadBackgroundStyle(mediaStyle)}
      />
      <Html5Video
        src={src}
        className="size-full"
        muted={muted}
        pauseWhenBuffering
        playbackRate={playbackRate}
        preservePitch={preservePitch}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        style={blurPadForegroundStyle(mediaStyle)}
      />
    </AbsoluteFill>
  );
}
