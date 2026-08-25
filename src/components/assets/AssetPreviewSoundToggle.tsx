import { Volume2, VolumeX } from 'lucide-react';

import { useAssetPreviewSound } from '@/shared/hooks/useAssetPreviewSound';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

/**
 * Turns preview sound on or off for every asset preview at once.
 *
 * Clicking it is also what unlocks unmuted playback: browsers refuse to start
 * audible media until the page has seen a gesture, so the toggle both records
 * the preference and satisfies that requirement.
 */
export function AssetPreviewSoundToggle({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { soundEnabled, toggleSound } = useAssetPreviewSound();
  const label = soundEnabled ? t.assets.previewMute : t.assets.previewUnmute;
  const Icon = soundEnabled ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={soundEnabled}
      title={label}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded text-white/90 transition-colors hover:bg-white/15 hover:text-white',
        className,
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSound();
      }}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}
