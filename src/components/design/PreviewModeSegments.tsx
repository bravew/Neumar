import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type PreviewMode =
  | 'preview'
  | 'source'
  | 'inspect'
  | 'comment'
  | 'edit'
  | 'draw';

const DEFAULT_MODES: PreviewMode[] = [
  'preview',
  'source',
  'inspect',
  'comment',
  'edit',
  'draw',
];

export function PreviewModeSegments({
  value,
  onChange,
  modes = DEFAULT_MODES,
}: {
  value: PreviewMode;
  onChange: (mode: PreviewMode) => void;
  modes?: PreviewMode[];
}) {
  const { t } = useLanguage();
  return (
    <div className="bg-muted flex rounded-md p-1" role="tablist">
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={value === mode}
          className={cn(
            'rounded px-3 py-1 text-xs capitalize',
            value === mode
              ? 'bg-background shadow-xs'
              : 'text-muted-foreground',
          )}
          onClick={() => onChange(mode)}
        >
          {t.design.previewModes[mode]}
        </button>
      ))}
    </div>
  );
}
