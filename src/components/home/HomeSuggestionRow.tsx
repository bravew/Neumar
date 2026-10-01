import { Link, useNavigate } from 'react-router-dom';

import { useSettingsValue } from '@/shared/db/settings';
import { ideaLabel, ideaPrompt } from '@/shared/ideas/idea-text';
import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas, type IdeaDefinition } from '@/shared/ideas/types';
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
  const { simpleShell, ideasFeedback } = useSettingsValue().ui;
  const { t } = useLanguage();
  const navigate = useNavigate();
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

  const ideas = visibleIdeas(listIdeas(), ideasFeedback).slice(0, 3);

  // Same outcomes as "Let's do it" in the gallery. Scoping ideas open their
  // card there, since the questions need room to answer.
  const select = (idea: IdeaDefinition) => {
    switch (idea.action.kind) {
      case 'prefill': {
        const prompt = ideaPrompt(t.ideas, idea);
        if (prompt) onSelectPrompt(prompt);
        return;
      }
      case 'nav':
        navigate(idea.action.path);
        return;
      case 'scoping':
        navigate(`/ideas?scope=${encodeURIComponent(idea.id)}`);
        return;
    }
  };

  return (
    <div
      data-testid="home-suggestion-row"
      className="mt-3 flex flex-wrap items-center justify-center gap-2"
    >
      {ideas.map((idea) => (
        <button
          key={idea.id}
          type="button"
          className="text-sm"
          onClick={() => select(idea)}
        >
          {ideaLabel(t.ideas, idea.promiseKey)}
        </button>
      ))}
      <Link to="/ideas" className="text-sm">
        {t.ideas.title}
      </Link>
    </div>
  );
}
