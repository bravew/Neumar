import { useCallback, useRef, useState } from 'react';

import { Image as ImageIcon } from 'lucide-react';

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  return `${mins}:${String(whole % 60).padStart(2, '0')}`;
}

interface AssetVideoHoverPreviewProps {
  src: string;
  poster?: string | null;
}

/**
 * Looping muted preview with a scrub bar.
 *
 * The loop shows what the clip *is*; the scrub bar is how you find a specific
 * moment in it, which is the whole reason to hover a shot you already
 * recognise. Dragging pauses so the frame under the pointer is the frame you
 * see, and playback resumes on release — the behaviour of every media browser
 * that offers hover scrubbing.
 */
export function AssetVideoHoverPreview({
  src,
  poster,
}: AssetVideoHoverPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeAfterScrubRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const beginScrub = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    resumeAfterScrubRef.current = !video.paused;
    video.pause();
  }, []);

  const endScrub = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (resumeAfterScrubRef.current) void video.play().catch(() => {});
    resumeAfterScrubRef.current = false;
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  return (
    <div className="group/preview bg-muted text-muted-foreground relative flex aspect-video items-center justify-center overflow-hidden rounded-md">
      <ImageIcon className="absolute size-7" aria-hidden />
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        className="relative size-full object-cover"
        muted
        autoPlay
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
      {duration > 0 ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 pt-4 pb-1.5 opacity-0 transition-opacity group-hover/preview:opacity-100">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={Math.min(currentTime, duration)}
            aria-label="Scrub preview"
            className="accent-primary h-1 min-w-0 flex-1 cursor-pointer"
            onPointerDown={(event) => {
              event.stopPropagation();
              beginScrub();
            }}
            onPointerUp={endScrub}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => seekTo(Number(event.target.value))}
            onClick={(event) => event.stopPropagation()}
          />
          <span className="shrink-0 text-[10px] font-medium text-white tabular-nums">
            {formatClock(currentTime)} / {formatClock(duration)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
