import { Link } from 'react-router-dom';

import { useSettingsValue } from '@/shared/db/settings';
import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas } from '@/shared/ideas/types';
import type { ChipDefinition } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

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
  const simpleShell = useSettingsValue().ui.simpleShell;
  const feedback = useSettingsValue().ui.ideasFeedback;
  const { t } = useLanguage();
  if (!simpleShell) {
    return (
      <div
        data-testid="home-suggestion-row"
        className="mt-3 flex flex-wrap items-center justify-center gap-2"
      >
        <StarterChips chips={chips} onSelect={onSelectChip} />
      </div>
    );
  }

  const ideas = visibleIdeas(listIdeas(), feedback).slice(0, 3);
  const messages = t.ideas as unknown as {
    promise: Record<string, string>;
    prompt: Record<string, string>;
    title: string;
  };

  return (
    <div
      data-testid="home-suggestion-row"
      className="mt-3 flex flex-wrap items-center justify-center gap-2"
    >
      {ideas.map((idea) => {
        const key = idea.promiseKey.split('.').pop() ?? '';
        const prompt =
          idea.action.kind === 'prefill'
            ? (messages.prompt[idea.action.promptKey.split('.').pop() ?? ''] ??
              '')
            : '';
        return (
          <button
            key={idea.id}
            type="button"
            className="text-sm"
            onClick={() => prompt && onSelectPrompt(prompt)}
          >
            {messages.promise[key] ?? idea.id}
          </button>
        );
      })}
      <Link to="/ideas" className="text-sm">
        {messages.title}
      </Link>
    </div>
  );
}
