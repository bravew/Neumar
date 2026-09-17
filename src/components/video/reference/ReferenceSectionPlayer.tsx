import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import type {
  VideoReferenceEvidenceItem,
  VideoReferenceTimelineSection,
} from '@/shared/types/video';

import { ReferenceSectionList } from './ReferenceSectionList';
import { ReferenceVideoScrubber } from './ReferenceVideoScrubber';
import {
  activeSectionAt,
  reachedSectionEnd,
  volumeAfterMuteToggle,
  volumeAfterSliderChange,
} from './sectionPlayback';
import { useReferenceThumbnails } from './useReferenceThumbnails';

interface ReferenceSectionPlayerProps {
  mediaUrl: string;
  sections: VideoReferenceTimelineSection[];
  evidence: VideoReferenceEvidenceItem[];
}

const DEFAULT_VOLUME = 1;

/**
 * The reference's timeline, playable one section at a time.
 *
 * A structural reading is a claim about footage, and a list of timecodes is a
 * poor way to check a claim. One shared player sits above the list; picking a
 * section seeks it there and stops at the section's end, so the sections become
 * clips the user can flip between. Playback runs the other way too: whatever
 * the playhead is over is the row highlighted in the list, so scrubbing the
 * video reads the analysis with you.
 *
 * Fullscreen keeps that pairing rather than dropping to a bare video: the
 * analysis moves to a column beside the picture, which is where it is most
 * useful — a big frame to judge, and the claim about it next to the evidence.
 */
export function ReferenceSectionPlayer({
  mediaUrl,
  sections,
  evidence,
}: ReferenceSectionPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const thumbnails = useReferenceThumbnails(
    mediaUrl,
    sections.map((section) => section.startMs),
  );
  // The section the user asked to play, clamped at its end. Held in a ref so
  // the animation loop reads it without resubscribing on every selection.
  const clampRef = useRef<VideoReferenceTimelineSection | null>(null);
  const [clampedId, setClampedId] = useState<string | null>(null);

  // The playhead drives the highlight, so a free scrub lands on the right row.
  const activeSection = activeSectionAt(sections, currentMs);

  const play = useCallback((section: VideoReferenceTimelineSection) => {
    const video = videoRef.current;
    if (!video) return;
    clampRef.current = section;
    setClampedId(section.id);
    video.currentTime = section.startMs / 1000;
    setCurrentMs(section.startMs);
    void video.play().catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    videoRef.current?.pause();
    clampRef.current = null;
    setClampedId(null);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, []);

  const seek = useCallback((ms: number) => {
    const video = videoRef.current;
    if (!video) return;
    // A manual scrub leaves the chosen section: the user is browsing now.
    clampRef.current = null;
    setClampedId(null);
    video.currentTime = ms / 1000;
    setCurrentMs(ms);
  }, []);

  const changeVolume = useCallback((next: number) => {
    const state = volumeAfterSliderChange(next);
    setVolume(state.volume);
    setMuted(state.muted);
  }, []);

  const toggleMute = useCallback(() => {
    const state = volumeAfterMuteToggle(volume, muted, DEFAULT_VOLUME);
    setVolume(state.volume);
    setMuted(state.muted);
  }, [muted, volume]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void container.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // The browser owns fullscreen state: Esc and the OS chrome can leave it
  // without going through our button, so follow the event rather than assume.
  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, volume]);

  // `timeupdate` fires about four times a second, which makes the playhead
  // visibly step. Drive it from the frame loop while playing instead.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const tick = () => {
      const ms = video.currentTime * 1000;
      setCurrentMs(ms);
      if (reachedSectionEnd(clampRef.current, ms)) {
        video.pause();
        clampRef.current = null;
        setClampedId(null);
      }
      frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
      setCurrentMs(video.currentTime * 1000);
    };
    const onLoaded = () => setDurationMs(video.duration * 1000);
    const onSeeked = () => setCurrentMs(video.currentTime * 1000);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    if (video.readyState >= 1) onLoaded();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
    };
  }, []);

  const sectionList = (
    <ReferenceSectionList
      sections={sections}
      evidence={evidence}
      thumbnails={thumbnails}
      activeSectionId={activeSection?.id ?? null}
      clampedSectionId={clampedId}
      playing={playing}
      onPlay={play}
      onStop={stop}
    />
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        fullscreen ? 'bg-background flex size-full gap-3 p-3 text-xs' : 'block',
      )}
    >
      <div
        className={cn(
          fullscreen
            ? 'flex min-w-0 flex-1 flex-col justify-center gap-2'
            : 'bg-background/95 sticky top-0 z-10 -mx-1 space-y-1 px-1 pb-2 backdrop-blur',
        )}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- reference footage carries no captions track */}
        <video
          ref={videoRef}
          className={cn(
            'bg-muted w-full rounded-md',
            fullscreen ? 'min-h-0 flex-1 object-contain' : 'aspect-video',
          )}
          preload="metadata"
          crossOrigin="anonymous"
          src={mediaUrl}
          onClick={togglePlay}
        />
        <ReferenceVideoScrubber
          sections={sections}
          durationMs={durationMs}
          currentMs={currentMs}
          playing={playing}
          activeSectionId={activeSection?.id ?? null}
          volume={volume}
          muted={muted}
          fullscreen={fullscreen}
          analysisOpen={analysisOpen}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={changeVolume}
          onToggleMute={toggleMute}
          onToggleFullscreen={toggleFullscreen}
          onToggleAnalysis={() => setAnalysisOpen((prev) => !prev)}
        />
        {activeSection ? (
          <p className="text-muted-foreground truncate text-[11px]">
            {activeSection.phase}
          </p>
        ) : null}
      </div>
      {fullscreen ? (
        analysisOpen ? (
          <div className="w-96 shrink-0 overflow-y-auto pr-1">
            {sectionList}
          </div>
        ) : null
      ) : (
        <div className="mt-3">{sectionList}</div>
      )}
    </div>
  );
}
