import { useId } from 'react';

import { Lock } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const SUPPORTED_AUDIO_KINDS = new Set(['speech', 'voiceover']);

export function AudioKindPicker({
  value,
  unsupportedTitle,
  onChange,
}: {
  value?: 'speech' | 'voiceover' | 'music' | 'sfx' | 'ambience';
  unsupportedTitle: string;
  onChange: (
    value: 'speech' | 'voiceover' | 'music' | 'sfx' | 'ambience',
  ) => void;
}) {
  const { t } = useLanguage();
  const labels = t.creative.mediaGeneration.audioKind;
  const unsupportedDescriptionId = useId();

  return (
    <div
      className="grid grid-cols-2 gap-2"
      role="group"
      aria-label={labels.label}
    >
      <p id={unsupportedDescriptionId} className="sr-only">
        {unsupportedTitle}
      </p>
      {(['speech', 'voiceover', 'music', 'sfx', 'ambience'] as const).map(
        (kind) => {
          const supported = SUPPORTED_AUDIO_KINDS.has(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={value === kind}
              aria-disabled={!supported}
              aria-label={labels[kind]}
              aria-describedby={
                supported ? undefined : unsupportedDescriptionId
              }
              className={cn(
                'data-[active=true]:border-primary data-[active=true]:bg-primary/10 inline-flex items-center justify-center gap-2 rounded-md border p-2 text-sm',
                !supported &&
                  'text-muted-foreground bg-muted/30 cursor-not-allowed',
              )}
              data-active={value === kind}
              title={supported ? undefined : unsupportedTitle}
              onClick={() => {
                if (supported) onChange(kind);
              }}
            >
              {!supported && <Lock className="size-3" />}
              {labels[kind]}
            </button>
          );
        },
      )}
    </div>
  );
}
