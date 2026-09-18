import { Volume1, Volume2, VolumeX } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface ReferenceVolumeControlProps {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
}

/**
 * Mute toggle plus a slider that expands on hover or focus.
 *
 * Collapsed by default because the rail is narrow and the transport already
 * competes for width; the slider is still reachable by keyboard, since focus
 * expands it the same way hover does.
 */
export function ReferenceVolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: ReferenceVolumeControlProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.reading;
  const Icon =
    muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="group/volume flex shrink-0 items-center">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center"
        aria-label={muted ? copy.unmute : copy.mute}
        onClick={onToggleMute}
      >
        <Icon className="size-3.5" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label={copy.volume}
        className="accent-primary w-0 cursor-pointer opacity-0 transition-all group-hover/volume:w-14 group-hover/volume:opacity-100 focus:w-14 focus:opacity-100"
        onChange={(event) => onVolumeChange(Number(event.target.value))}
      />
    </div>
  );
}
