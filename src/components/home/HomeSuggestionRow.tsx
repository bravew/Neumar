import type { ChipDefinition } from '@/shared/modes/types';

import { QuickActions } from './QuickActions';
import { StarterChips } from './StarterChips';

interface HomeSuggestionRowProps {
  chips: ChipDefinition[];
  onSelectChip: (chip: ChipDefinition) => void;
  onSelectPrompt: (prompt: string) => void;
}

export function HomeSuggestionRow({
  chips,
  onSelectChip,
  onSelectPrompt,
}: HomeSuggestionRowProps) {
  return (
    <div
      data-testid="home-suggestion-row"
      className="mt-3 flex flex-wrap items-center justify-center gap-2"
    >
      <StarterChips chips={chips} onSelect={onSelectChip} />
      <QuickActions onSelectPrompt={onSelectPrompt} />
    </div>
  );
}
