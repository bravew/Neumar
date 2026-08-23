import { useCallback, useEffect, useRef, useState } from 'react';

import { Image as ImageIcon, Pause, Play } from 'lucide-react';

import { useAssetPreviewSound } from '@/shared/hooks/useAssetPreviewSound';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { AssetPreviewSoundToggle } from './AssetPreviewSoundToggle';

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
 * Looping preview with a scrub bar and a sound toggle.
 *
 * The loop shows what the clip *is*; the scrub bar is how you find a specific
 * moment in it, which is the whole reason to hover a shot you already
 * recognise. Dragging pauses so the frame under the pointer is the frame you
 * see, and playback resumes on release — the behaviour of every media browser
 * that offers hover scrubbing.
 *
 * Sound follows the shared preview preference, so unmuting one clip means the
 * next one you hover is audible too.
 */
export function AssetVideoHoverPreview({
  src,
  poster,
}: AssetVideoHoverPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeAfterScrubRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Driven only by the element's own play/pause events. Assuming "playing"
  // because autoplay was requested puts a pause icon on a video that never
  // started — which is exactly what happens when the browser blocks autoplay.
  const [playing, setPlaying] = useState(false);
  const { soundEnabled } = useAssetPreviewSound();
  const { t } = useLanguage();

  // `muted` has to be set as a property. React writes it as an attribute, which
  // Chrome ignores after the element exists, so toggling sound would otherwise
  // only take effect on the next mount.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !soundEnabled;
    if (video.paused) return;
    void video.play().catch(() => {
      // Audible playback needs a gesture this page hasn't seen yet — typical
      // on a fresh load where the preference came from storage. Keep the
      // preference (the user asked for sound, and their next click unlocks it)
      // and play muted so the preview still moves.
      video.muted = true;
      void video.play().catch(() => {});
    });
  }, [soundEnabled]);

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

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
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
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 pt-4 pb-1.5 transition-opacity group-hover/preview:opacity-100',
          // Stay visible while paused: the button that resumes is in here.
          playing ? 'opacity-0' : 'opacity-100',
        )}
      >
        <button
          type="button"
          aria-label={playing ? t.assets.previewPause : t.assets.previewPlay}
          title={playing ? t.assets.previewPause : t.assets.previewPlay}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-white/90 transition-colors hover:bg-white/15 hover:text-white"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePlayback();
          }}
        >
          {playing ? (
            <Pause className="size-3.5" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )}
        </button>
        <AssetPreviewSoundToggle />
        {duration > 0 ? (
          <>
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
          </>
        ) : null}
      </div>
    </div>
  );
}
