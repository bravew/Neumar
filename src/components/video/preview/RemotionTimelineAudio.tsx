import {
  audioEnvelopeGainAtFrame,
  bookendAudioGainAtFrame,
  bookendOverlayOpacity,
  normalizeClipPlayback,
} from '@neumar/video-ir';
import { AbsoluteFill, Html5Audio, useCurrentFrame } from 'remotion';

import type { RemotionAudioClip } from './remotionPreviewData';

export function AudioClip({
  clip,
  compositionDurationInFrames,
  fps,
  introFrames,
  outroFrames,
}: {
  clip: RemotionAudioClip;
  compositionDurationInFrames: number;
  fps: number;
  introFrames?: number;
  outroFrames?: number;
}) {
  const playback = normalizeClipPlayback(clip.playback);
  if (playback.reverse) return null;
  return (
    <Html5Audio
      src={clip.src!}
      playbackRate={playback.speed}
      preservePitch={playback.pitchCorrection !== false}
      volume={(frame) => {
        const absoluteFrame = clip.fromFrame + frame;
        return (
          legacyVolumeFallback(clip) *
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
      }}
      trimBefore={clip.sourceStartFrame}
      trimAfter={clip.sourceEndFrame}
    />
  );
}

function legacyVolumeFallback(clip: RemotionAudioClip): number {
  // Keep in sync with WebCodecs AudioEngine and backend remotion-composition
  // until legacy `volume` payloads are fully migrated to gainDb/keyframes.
  return clip.gainDb === undefined &&
    clip.trackVolumeDb === undefined &&
    !clip.keyframes
    ? clip.volume
    : 1;
}

export function BookendFadeOverlay({
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
  return <AbsoluteFill style={{ backgroundColor: '#000000', opacity }} />;
}
