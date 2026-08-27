import { useLanguage } from '@/shared/providers/language-provider';

import type { PreviewViewMode } from './OutputReview';

export type { PreviewViewMode };

/**
 * Switch between the live timeline simulation and the file the last render
 * actually produced. They are different artefacts — the preview re-derives the
 * edit every frame, the output is bytes on disk with its own codec, loudness
 * and colour handling — so checking the result means watching the file, not
 * the simulation of it.
 */
export function PreviewModeToggle({
  mode,
  onChange,
  outputAvailable,
}: {
  mode: PreviewViewMode;
  onChange: (mode: PreviewViewMode) => void;
  outputAvailable: boolean;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.preview;
  return (
    <div className="border-border inline-flex overflow-hidden rounded-md border">
      {(['preview', 'output'] as const).map((value) => {
        const disabled = value === 'output' && !outputAvailable;
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={mode === value}
            title={disabled ? labels.outputUnavailable : undefined}
            onClick={() => onChange(value)}
            className={
              mode === value
                ? 'bg-primary text-primary-foreground px-2 py-1 text-xs font-medium'
                : 'hover:bg-accent px-2 py-1 text-xs disabled:opacity-40'
            }
          >
            {value === 'preview' ? labels.modePreview : labels.modeOutput}
          </button>
        );
      })}
    </div>
  );
}
