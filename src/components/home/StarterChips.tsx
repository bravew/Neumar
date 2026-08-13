import type { ChipDefinition } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

interface StarterChipsProps {
  chips: ChipDefinition[];
  onSelect: (chip: ChipDefinition) => void;
}

export function StarterChips({ chips, onSelect }: StarterChipsProps) {
  const { tt } = useLanguage();
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onSelect(chip)}
            className="border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:bg-accent hover:text-foreground flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm transition-all hover:-translate-y-0.5"
          >
            <Icon className="size-4" />
            <span>{tt(chip.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
