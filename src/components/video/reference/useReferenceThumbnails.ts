import { useEffect, useState } from 'react';

const THUMBNAIL_WIDTH = 160;

/**
 * Frame grabs for a reference's section starts.
 *
 * Captured in the browser from the same media the player streams, one seek at a
 * time in a detached video element: the run's evidence grids are sampled for
 * the agent's reading, not for display, and asking the API for per-section
 * stills would mean a new render path for something the client can already see.
 *
 * Returns a map keyed by the times passed in. Missing entries are normal —
 * a codec the canvas cannot read, a cross-origin taint, or a seek that never
 * settles — so callers must render without a thumbnail.
 */
export function useReferenceThumbnails(
  mediaUrl: string,
  timesMs: number[],
): Record<number, string> {
  const [frames, setFrames] = useState<Record<number, string>>({});
  // Join to a primitive: a fresh array identity each render would restart the
  // capture loop forever.
  const key = timesMs.join(',');

  useEffect(() => {
    if (!mediaUrl || !key) return;
    let cancelled = false;
    const times = key.split(',').map(Number);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = mediaUrl;

    const seekTo = (seconds: number) =>
      new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('seek failed'));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('seek timed out'));
        }, 5000);
        function cleanup() {
          clearTimeout(timer);
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
        }
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.currentTime = seconds;
      });

    const ready = new Promise<void>((resolve, reject) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener(
        'error',
        () => reject(new Error('media failed to load')),
        { once: true },
      );
    });

    void (async () => {
      try {
        await ready;
        const canvas = document.createElement('canvas');
        const ratio =
          video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = Math.round(THUMBNAIL_WIDTH * ratio);
        const context = canvas.getContext('2d');
        if (!context) return;
        for (const timeMs of times) {
          if (cancelled) return;
          try {
            await seekTo(Math.min(timeMs / 1000, video.duration - 0.05));
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            if (cancelled) return;
            setFrames((prev) => ({ ...prev, [timeMs]: dataUrl }));
          } catch {
            // One unreadable frame must not stop the rest.
          }
        }
      } catch {
        // No thumbnails for this media; the list renders without them.
      }
    })();

    return () => {
      cancelled = true;
      video.removeAttribute('src');
      video.load();
    };
  }, [key, mediaUrl]);

  return frames;
}
