import type { VideoAspectRatio } from '@/shared/types/video';

interface PreviewAspectPickerProps {
  value: VideoAspectRatio;
  ariaLabel: string;
  options: readonly VideoAspectRatio[];
  onChange: (value: VideoAspectRatio) => void;
}

export function PreviewAspectPicker({
  value,
  ariaLabel,
  options,
  onChange,
}: PreviewAspectPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="border-border flex overflow-hidden rounded-md border"
    >
      {options.map((option) => (
        <button
          type="button"
          key={option}
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={
            value === option
              ? 'bg-primary text-primary-foreground px-2 py-1 text-[11px]'
              : 'hover:bg-accent px-2 py-1 text-[11px]'
          }
        >
          {option}
        </button>
      ))}
    </div>
  );
}
