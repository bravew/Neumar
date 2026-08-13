import {
  formatPreviewPlaybackRate,
  parsePreviewPlaybackRate,
  PREVIEW_PLAYBACK_RATES,
  type PreviewPlaybackRate,
} from './previewPlaybackRate';

interface PreviewPlaybackSpeedSelectProps {
  ariaLabel: string;
  value: PreviewPlaybackRate;
  onChange: (value: PreviewPlaybackRate) => void;
}

export function PreviewPlaybackSpeedSelect({
  ariaLabel,
  value,
  onChange,
}: PreviewPlaybackSpeedSelectProps) {
  return (
    <select
      aria-label={ariaLabel}
      title={ariaLabel}
      value={String(value)}
      onChange={(event) => {
        const nextRate = parsePreviewPlaybackRate(event.currentTarget.value);
        if (nextRate !== null) onChange(nextRate);
      }}
      className="border-border bg-background hover:bg-accent h-7 rounded-md border px-2 text-[11px]"
    >
      {PREVIEW_PLAYBACK_RATES.map((rate) => (
        <option key={rate} value={String(rate)}>
          {formatPreviewPlaybackRate(rate)}
        </option>
      ))}
    </select>
  );
}
