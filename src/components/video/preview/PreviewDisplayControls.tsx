import type { VideoAspectRatio } from '@/shared/types/video';

import { PreviewAspectPicker } from './PreviewAspectPicker';
import type { PreviewPlaybackRate } from './previewPlaybackRate';
import { PreviewPlaybackSpeedSelect } from './PreviewPlaybackSpeedSelect';

interface PreviewDisplayControlsProps {
  aspect: VideoAspectRatio;
  aspectLabel: string;
  aspectOptions: readonly VideoAspectRatio[];
  playbackRate: PreviewPlaybackRate;
  playbackRateLabel: string;
  onAspectChange: (aspect: VideoAspectRatio) => void;
  onPlaybackRateChange: (playbackRate: PreviewPlaybackRate) => void;
}

export function PreviewDisplayControls({
  aspect,
  aspectLabel,
  aspectOptions,
  playbackRate,
  playbackRateLabel,
  onAspectChange,
  onPlaybackRateChange,
}: PreviewDisplayControlsProps) {
  return (
    <>
      <PreviewAspectPicker
        value={aspect}
        ariaLabel={aspectLabel}
        options={aspectOptions}
        onChange={onAspectChange}
      />
      <PreviewPlaybackSpeedSelect
        ariaLabel={playbackRateLabel}
        value={playbackRate}
        onChange={onPlaybackRateChange}
      />
      <div className="bg-border h-4 w-px" aria-hidden />
    </>
  );
}
