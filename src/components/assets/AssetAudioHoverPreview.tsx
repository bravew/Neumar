import { useEffect, useRef } from 'react';

import { AudioLines } from 'lucide-react';

import { useAssetPreviewSound } from '@/shared/hooks/useAssetPreviewSound';

import { AssetPreviewSoundToggle } from './AssetPreviewSoundToggle';

/**
 * Player for an asset that has no frame to show.
 *
 * Plays on hover when preview sound is on — the same preference the video
 * preview uses, so "let me hear these" means one thing across the library. With
 * sound off it stays silent and waits for a click, because a list of tracks
 * that starts playing as the pointer crosses it is hostile.
 */
export function AssetAudioHoverPreview({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { soundEnabled } = useAssetPreviewSound();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!soundEnabled) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => {
      // Audible playback needs a gesture this page hasn't seen yet — typical on
      // a fresh load where the preference came from storage. Leave it paused
      // with its controls rather than clearing a preference the user set on
      // purpose; their next click anywhere unlocks the one after this.
    });
  }, [soundEnabled, src]);

  return (
    <div className="bg-muted flex items-center gap-2 rounded-md p-2">
      <AudioLines
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
      <audio
        ref={audioRef}
        src={src}
        controls
        preload="metadata"
        className="h-8 min-w-0 flex-1"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <track kind="captions" />
      </audio>
      <AssetPreviewSoundToggle className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground" />
    </div>
  );
}
