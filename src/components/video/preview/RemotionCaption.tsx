import { useEffect } from 'react';

import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { loadGoogleFontIfNeeded } from '../clipInspector/fonts';
import {
  DEFAULT_CAPTION_ACCENT,
  isAnimatedCaptionStyle,
  resolveCaptionWords,
} from './captionWordRender';
import type { RemotionCaption } from './remotionPreviewData';

/**
 * Always-normalized caption layout used by the live Remotion preview. The
 * on-canvas editor overlay grabs the caption at the exact coords we draw
 * here; if these defaults drift, the user grabs invisible handles. The
 * backend Remotion composition (full render) mirrors this with the same
 * defaults so preview and export match.
 */
export function Caption({ caption }: { caption: RemotionCaption }) {
  const defaultY =
    caption.position === 'top'
      ? 0.1
      : caption.position === 'middle'
        ? 0.5
        : 0.85;
  const cx = Math.max(0, Math.min(1, caption.positionX ?? 0.5));
  const cy = Math.max(0, Math.min(1, caption.positionY ?? defaultY));
  const maxW = Math.max(0.05, Math.min(1, caption.maxWidth ?? 0.8));
  const opacity = useEntranceExitOpacity(
    caption.durationInFrames,
    caption.entranceFrames ?? 0,
    caption.exitFrames ?? 0,
  );
  useEffect(
    () => loadGoogleFontIfNeeded(caption.fontFamily),
    [caption.fontFamily],
  );
  const stroke =
    caption.strokeColor && caption.strokeWidth && caption.strokeWidth > 0
      ? {
          WebkitTextStrokeWidth: `${caption.strokeWidth}px`,
          WebkitTextStrokeColor: caption.strokeColor,
        }
      : {};
  const textShadow = buildTextShadow(caption);
  return (
    <AbsoluteFill className="pointer-events-none" style={{ opacity }}>
      <div
        style={{
          position: 'absolute',
          left: `${cx * 100}%`,
          top: `${cy * 100}%`,
          width: `${maxW * 100}%`,
          transform: 'translateX(-50%)',
        }}
      >
        <span
          className="block rounded px-4 py-2 leading-tight text-white shadow-lg"
          style={{
            fontFamily: caption.fontFamily,
            fontSize: caption.fontSize ? `${caption.fontSize}px` : undefined,
            color: caption.color,
            background: caption.background ?? 'rgba(0,0,0,0.7)',
            textAlign: caption.textAlign ?? 'center',
            fontWeight: caption.fontWeight ?? 700,
            fontStyle: caption.fontStyle ?? 'normal',
            textDecoration: caption.textDecoration ?? 'none',
            textShadow,
            ...stroke,
          }}
        >
          <CaptionBody caption={caption} />
        </span>
      </div>
    </AbsoluteFill>
  );
}

/**
 * The cue body: a plain string for classic/static styles, or per-word spans
 * (emphasis + progressive reveal) for the animated styles. Mirrors the backend
 * render composition so the preview matches the export.
 */
function CaptionBody({ caption }: { caption: RemotionCaption }) {
  const frame = useCurrentFrame();
  const words = caption.words;
  const animation = caption.animation;
  if (!words?.length || !isAnimatedCaptionStyle(animation)) {
    return <>{caption.text}</>;
  }
  const baseColor = caption.color ?? '#ffffff';
  const scales = animation === 'hormozi-bold' || animation === 'tiktok-word';
  return (
    <>
      {resolveCaptionWords(words, frame, animation)
        .filter((word) => word.visible)
        .map((word, index) => (
          <span
            key={index}
            style={{
              display: 'inline-block',
              margin: '0 0.14em',
              color: word.emphasized ? DEFAULT_CAPTION_ACCENT : baseColor,
              transform: word.emphasized && scales ? 'scale(1.12)' : 'scale(1)',
              transformOrigin: 'center',
            }}
          >
            {word.text}
          </span>
        ))}
    </>
  );
}

/**
 * Translate the shadow fields (canvas-relative px against a 1080 reference)
 * into a CSS `text-shadow` value. Returns `undefined` so React drops the
 * property cleanly when shadow is disabled — keeps the rendered DOM stable
 * for existing captions.
 */
function buildTextShadow(caption: RemotionCaption): string | undefined {
  const color = caption.shadowColor;
  const offX = caption.shadowOffsetX ?? 0;
  const offY = caption.shadowOffsetY ?? 0;
  const blur = caption.shadowBlur ?? 0;
  if (!color || (offX === 0 && offY === 0 && blur === 0)) return undefined;
  return `${offX}px ${offY}px ${blur}px ${color}`;
}

function useEntranceExitOpacity(
  durationFrames: number,
  entranceFrames: number,
  exitFrames: number,
): number {
  const frame = useCurrentFrame();
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
