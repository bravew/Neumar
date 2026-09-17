import { useCallback, useEffect, useRef, useState } from 'react';

import { Play, Square } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoReferenceEvidenceItem,
  VideoReferenceTimelineSection,
} from '@/shared/types/video';

import { ReferenceVideoScrubber } from './ReferenceVideoScrubber';
import { activeSectionAt, reachedSectionEnd } from './sectionPlayback';
import { useReferenceThumbnails } from './useReferenceThumbnails';

interface ReferenceSectionPlayerProps {
  mediaUrl: string;
  sections: VideoReferenceTimelineSection[];
  evidence: VideoReferenceEvidenceItem[];
}

/**
 * The reference's timeline, playable one section at a time.
 *
 * A structural reading is a claim about footage, and a list of timecodes is a
 * poor way to check a claim. One shared player sits above the list; picking a
 * section seeks it there and stops at the section's end, so the sections become
 * clips the user can flip between. Playback runs the other way too: whatever
 * the playhead is over is the row highlighted in the list, so scrubbing the
 * video reads the analysis with you.
 */
export function ReferenceSectionPlayer({
  mediaUrl,
  sections,
  evidence,
}: ReferenceSectionPlayerProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.reading;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
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

  return (
    <div className="space-y-3">
      <div className="bg-background/95 sticky top-0 z-10 -mx-1 space-y-1 px-1 pb-2 backdrop-blur">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- reference footage carries no captions track */}
        <video
          ref={videoRef}
          className="bg-muted aspect-video w-full rounded-md"
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
          onTogglePlay={togglePlay}
          onSeek={seek}
        />
        {activeSection ? (
          <p className="text-muted-foreground truncate text-[11px]">
            {activeSection.phase}
          </p>
        ) : null}
      </div>
      <ol className="space-y-2">
        {sections.map((section) => {
          const isActive = activeSection?.id === section.id;
          const isClamped = clampedId === section.id;
          const thumbnail = thumbnails[section.startMs];
          return (
            <li
              key={section.id}
              className={cn(
                'rounded border p-2 transition-colors',
                isActive ? 'border-primary/60 bg-accent/30' : 'border-border',
              )}
            >
              <div className="flex gap-2">
                <button
                  type="button"
                  className="group relative shrink-0 overflow-hidden rounded"
                  onClick={() => (isClamped ? stop() : play(section))}
                  aria-label={
                    isClamped
                      ? copy.stopSection
                      : copy.playSection.replace('{phase}', section.phase)
                  }
                >
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt=""
                      className="h-14 w-24 object-cover"
                    />
                  ) : (
                    <span className="bg-muted block h-14 w-24" />
                  )}
                  <span
                    className={cn(
                      'absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity',
                      isClamped
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    {isClamped && playing ? (
                      <Square className="size-4 text-white" />
                    ) : (
                      <Play className="size-4 text-white" />
                    )}
                  </span>
                </button>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <button
                      type="button"
                      className="truncate text-left font-medium"
                      onClick={() => play(section)}
                    >
                      {section.phase}
                    </button>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {formatRange(section.startMs, section.endMs)} ·{' '}
                      {copy.confidence} {section.confidence.toFixed(2)}
                    </span>
                  </div>
                  {section.anchor ? (
                    <p className="text-muted-foreground">{section.anchor}</p>
                  ) : null}
                  <p>{section.effect}</p>
                  <EvidenceIds
                    evidenceIds={section.evidenceIds}
                    evidence={evidence}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EvidenceIds({
  evidenceIds,
  evidence,
}: {
  evidenceIds: string[];
  evidence: VideoReferenceEvidenceItem[];
}) {
  const labels = evidenceIds.map((id) =>
    evidence.some((item) => item.id === id) ? id : `${id}?`,
  );
  return (
    <p className="text-muted-foreground text-[11px]">{labels.join(', ')}</p>
  );
}

function formatRange(startMs: number, endMs: number): string {
  return `${(startMs / 1000).toFixed(1)}s–${(endMs / 1000).toFixed(1)}s`;
}
