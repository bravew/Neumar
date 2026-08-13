import { Check } from 'lucide-react';

import { LANGUAGE_OPTIONS, type Language } from '@/config/locale';
import { cn } from '@/shared/lib/utils';

const LANGUAGE_ENGLISH_NAMES: Record<Language, string> = {
  'en-US': 'English',
  'zh-CN': 'Chinese',
  'es-ES': 'Spanish',
  'fr-FR': 'French',
  'hi-IN': 'Hindi',
  'pt-BR': 'Portuguese',
};

export function LanguageTileGrid({
  language,
  label,
  onSelect,
}: {
  language: Language;
  label: string;
  onSelect: (language: Language) => void;
}) {
  const moveSelection = (direction: 1 | -1) => {
    const currentIndex = LANGUAGE_OPTIONS.findIndex(
      (option) => option.value === language,
    );
    const nextIndex =
      (currentIndex + direction + LANGUAGE_OPTIONS.length) %
      LANGUAGE_OPTIONS.length;
    onSelect(LANGUAGE_OPTIONS[nextIndex]!.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))] gap-2"
      onKeyDown={(event) => {
        if (
          event.key !== 'ArrowRight' &&
          event.key !== 'ArrowDown' &&
          event.key !== 'ArrowLeft' &&
          event.key !== 'ArrowUp'
        ) {
          return;
        }
        event.preventDefault();
        moveSelection(
          event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1,
        );
      }}
    >
      {LANGUAGE_OPTIONS.map((opt) => {
        const selected = opt.value === language;
        const englishName = LANGUAGE_ENGLISH_NAMES[opt.value];
        return (
          <label
            key={opt.value}
            className={cn(
              'border-input bg-background hover:border-primary/50 flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 transition-colors',
              selected && 'border-primary bg-primary/5 ring-primary/20 ring-1',
            )}
          >
            <span className="min-w-0">
              <span className="text-foreground block text-sm font-medium">
                {opt.label}
              </span>
              <span className="text-muted-foreground block text-xs">
                {englishName}
              </span>
            </span>
            <input
              type="radio"
              name="settings-language"
              value={opt.value}
              checked={selected}
              onChange={() => onSelect(opt.value)}
              aria-label={`${opt.label} — ${englishName}`}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                'border-input flex size-5 shrink-0 items-center justify-center rounded-full border',
                selected && 'bg-primary text-primary-foreground border-primary',
              )}
            >
              {selected && <Check className="size-3.5" />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
