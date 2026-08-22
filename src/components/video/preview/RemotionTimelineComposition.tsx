import type { CSSProperties } from 'react';

import {
  localFrameToSourceFrame,
  normalizeClipPlayback,
} from '@neumar/video-ir';
import { TransitionSeries } from '@remotion/transitions';
import { AbsoluteFill, Freeze, Img, Sequence, useCurrentFrame } from 'remotion';

import { buildVideoClipCssFilter } from '../clipFilters';
import type { OverlayAssetLoader } from './overlays/vividOverlayPreviewModel';
import { BlurPadImage, BlurPadVideo, RemotionVideo } from './RemotionBlurPad';
import { Caption } from './RemotionCaption';
import { KenBurnsImage } from './RemotionKenBurnsImage';
import type {
  RemotionPreviewData,
  RemotionVisualClip,
} from './remotionPreviewData';
import { AudioClip, BookendFadeOverlay } from './RemotionTimelineAudio';
import {
  transitionFramesForClip,
  transitionPresentation,
  transitionTiming,
} from './remotionTransitionPresentations';
import { RemotionVividOverlayClip } from './RemotionVividOverlay';

export interface RemotionTimelineCompositionProps {
  data: RemotionPreviewData;
  useRemotionMedia?: boolean;
  /** In-browser Player only (functions don't serialize to headless renders). */
  loadOverlayAsset?: OverlayAssetLoader;
}

export function RemotionTimelineComposition({
  data,
  useRemotionMedia = true,
  loadOverlayAsset,
}: RemotionTimelineCompositionProps) {
  const visualTracks = groupVisualClipsByTrack(data.visualClips, data.fps);
  const size = { width: data.compositionWidth, height: data.compositionHeight };
  return (
    <AbsoluteFill className="bg-black">
      {visualTracks.map((track) =>
        track.hasTransitions ? (
          <TransitionVisualTrack
            key={track.id}
            clips={track.clips}
            fps={data.fps}
            size={size}
            useRemotionMedia={useRemotionMedia}
          />
        ) : (
          track.clips.map((clip) => (
            <VisualClipSequence
              key={clip.id}
              clip={clip}
              useRemotionMedia={useRemotionMedia}
            />
          ))
        ),
      )}
      {data.audioClips.map((clip) =>
        clip.src ? (
          <Sequence
            key={clip.id}
            from={clip.fromFrame}
            durationInFrames={clip.durationInFrames}
          >
            <AudioClip
              clip={clip}
              compositionDurationInFrames={data.durationInFrames}
              fps={data.fps}
              introFrames={data.introFrames}
              outroFrames={data.outroFrames}
            />
          </Sequence>
        ) : null,
      )}
      {data.vividOverlays.map((entry) => (
        <RemotionVividOverlayClip
          key={entry.clipId}
          entry={entry}
          loadAsset={loadOverlayAsset}
        />
      ))}
      {data.captions.map((caption) => (
        <Sequence
          key={caption.id}
          from={caption.fromFrame}
          durationInFrames={caption.durationInFrames}
        >
          <Caption caption={caption} />
        </Sequence>
      ))}
      <BookendFadeOverlay
        durationInFrames={data.durationInFrames}
        introFrames={data.introFrames}
        outroFrames={data.outroFrames}
      />
    </AbsoluteFill>
  );
}

function TransitionVisualTrack({
  clips,
  fps,
  size,
  useRemotionMedia,
}: {
  clips: RemotionVisualClip[];
  fps: number;
  size: { width: number; height: number };
  useRemotionMedia: boolean;
}) {
  let cursorFrame = 0;
  return (
    <TransitionSeries>
      {clips.flatMap((clip, index) => {
        const nextClip = clips[index + 1];
        const transitionFrames = transitionFramesForClip(clip, nextClip, fps);
        const gapFrames = Math.max(0, clip.fromFrame - cursorFrame);
        cursorFrame = clip.fromFrame + clip.durationInFrames;
        const nodes = [];
        if (gapFrames > 0) {
          nodes.push(
            <TransitionSeries.Sequence
              key={`${clip.id}-gap`}
              durationInFrames={gapFrames}
            />,
          );
        }
        nodes.push(
          <TransitionSeries.Sequence
            key={clip.id}
            durationInFrames={clip.durationInFrames + transitionFrames}
          >
            <VisualClip
              clip={clip}
              transitionTailFrames={transitionFrames}
              useRemotionMedia={useRemotionMedia}
            />
          </TransitionSeries.Sequence>,
        );
        if (transitionFrames > 0) {
          nodes.push(
            <TransitionSeries.Transition
              key={`${clip.id}-transition`}
              presentation={transitionPresentation(clip.transitionToNext, size)}
              timing={transitionTiming(clip.transitionToNext, transitionFrames)}
            />,
          );
        }
        return nodes;
      })}
    </TransitionSeries>
  );
}

function VisualClipSequence({
  clip,
  useRemotionMedia,
}: {
  clip: RemotionVisualClip;
  useRemotionMedia: boolean;
}) {
  return (
    <Sequence from={clip.fromFrame} durationInFrames={clip.durationInFrames}>
      <VisualClip
        clip={clip}
        transitionTailFrames={0}
        useRemotionMedia={useRemotionMedia}
      />
    </Sequence>
  );
}

function VisualClip({
  clip,
  transitionTailFrames,
  useRemotionMedia,
}: {
  clip: RemotionVisualClip;
  transitionTailFrames: number;
  useRemotionMedia: boolean;
}) {
  const frame = useCurrentFrame();
  const playback = normalizeClipPlayback(clip.playback);
  const style = transformStyle(clip);
  const mediaStyle = mediaElementStyle(clip);
  const blurPad = clip.transform?.fit === 'blur-pad';
  if (clip.src && clip.mediaKind === 'image') {
    return (
      <AbsoluteFill style={style}>
        {blurPad ? (
          <BlurPadImage src={clip.src} mediaStyle={mediaStyle} />
        ) : clip.imagePan ? (
          <KenBurnsImage
            src={clip.src}
            imagePan={clip.imagePan}
            durationInFrames={clip.durationInFrames + transitionTailFrames}
            mediaStyle={mediaStyle}
          />
        ) : (
          <Img
            src={clip.src}
            className="size-full object-cover"
            style={mediaStyle}
          />
        )}
      </AbsoluteFill>
    );
  }
  if (clip.src && clip.mediaKind === 'video') {
    const muted =
      clip.trackKind !== 'video' || clip.muted === true || playback.reverse;
    const trimAfter = sourceEndFrameWithTail(clip, transitionTailFrames);
    const playbackProps = playback.reverse
      ? {}
      : {
          playbackRate: playback.speed,
          preservePitch: playback.pitchCorrection !== false,
        };
    const content = blurPad ? (
      <BlurPadVideo
        src={clip.src}
        muted={muted}
        trimBefore={clip.sourceStartFrame}
        trimAfter={trimAfter}
        mediaStyle={mediaStyle}
        useRemotionMedia={useRemotionMedia}
        {...playbackProps}
      />
    ) : (
      <RemotionVideo
        src={clip.src}
        className="size-full object-cover"
        muted={muted}
        trimBefore={clip.sourceStartFrame}
        trimAfter={trimAfter}
        style={mediaStyle}
        useRemotionMedia={useRemotionMedia}
        {...playbackProps}
      />
    );
    const reverseFrame = playback.reverse
      ? localFrameToSourceFrame(frame, {
          playback,
          trimEndFrame: trimAfter,
          trimStartFrame: clip.sourceStartFrame,
        }) - clip.sourceStartFrame
      : null;
    return (
      <AbsoluteFill style={style}>
        {reverseFrame === null ? (
          content
        ) : (
          <Freeze frame={reverseFrame}>{content}</Freeze>
        )}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={style}
      className="flex items-center justify-center bg-zinc-900 px-10 text-center"
    >
      <span className="max-w-[80%] text-3xl font-semibold text-balance text-zinc-100">
        {clip.label}
      </span>
    </AbsoluteFill>
  );
}

function transformStyle(clip: RemotionVisualClip): CSSProperties {
  const transform = clip.transform;
  if (!transform) return {};
  const positionX = transform.positionX ?? 0.5;
  const positionY = transform.positionY ?? 0.5;
  return {
    backgroundColor: transform.background,
    opacity: transform.opacity,
    transform: [
      `translate(${(positionX - 0.5) * 100}%, ${(positionY - 0.5) * 100}%)`,
      `scale(${transform.scaleX ?? transform.scale ?? 1}, ${transform.scaleY ?? transform.scale ?? 1})`,
      `rotate(${transform.rotation ?? 0}deg)`,
    ].join(' '),
  };
}

function mediaElementStyle(
  clip: RemotionVisualClip,
): CSSProperties | undefined {
  const filter = buildVideoClipCssFilter(clip.filters);
  const objectPosition = objectPositionForReframe(clip.reframe?.anchor);
  const objectFit = objectFitForTransform(clip.transform?.fit);
  if (!filter && !objectPosition && objectFit === 'cover') return undefined;
  return {
    objectFit,
    ...(filter ? { filter } : {}),
    ...(objectPosition ? { objectPosition } : {}),
  };
}

function objectFitForTransform(
  fit: NonNullable<RemotionVisualClip['transform']>['fit'] | undefined,
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

function sourceEndFrameWithTail(
  clip: RemotionVisualClip,
  transitionTailFrames: number,
): number {
  return clip.sourceEndFrame + transitionTailFrames;
}

function groupVisualClipsByTrack(clips: RemotionVisualClip[], fps: number) {
  const byTrack = new Map<string, RemotionVisualClip[]>();
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
