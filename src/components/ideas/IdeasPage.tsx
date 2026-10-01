import { useState } from 'react';

import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { useSettingsValue } from '@/shared/db/settings';
import {
  ideaLabel,
  ideaPrompt,
  saveIdeaFeedback,
  scopedPrompt,
} from '@/shared/ideas/idea-text';
import { requestComposerPrefill } from '@/shared/ideas/prefill';
import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas, type IdeaDefinition } from '@/shared/ideas/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { ScopingCard } from './ScopingCard';

export function IdeasPage() {
  const { simpleShell, ideasFeedback } = useSettingsValue().ui;
  const { t } = useLanguage();
  const navigate = useNavigate();
  // Home's suggestion row links scoping ideas here with `?scope=<id>`.
  const [searchParams] = useSearchParams();
  const [scopingId, setScopingId] = useState<string | null>(
    searchParams.get('scope'),
  );
  if (!simpleShell) return <Navigate to="/" replace />;

  const ideas = visibleIdeas(listIdeas(), ideasFeedback);
  const groups = new Map<string, IdeaDefinition[]>();
  for (const idea of ideas) {
    const list = groups.get(idea.categoryKey) ?? [];
    list.push(idea);
    groups.set(idea.categoryKey, list);
  }

  // The open dock takes the prompt in place; otherwise Home picks it up.
  const prefill = (prompt: string) => {
    if (!prompt) return;
    if (!requestComposerPrefill(prompt)) navigate('/');
  };

  const letsDoIt = (idea: IdeaDefinition) => {
    switch (idea.action.kind) {
      case 'nav':
        navigate(idea.action.path);
        return;
      case 'scoping':
        setScopingId(idea.id);
        return;
      case 'prefill':
        prefill(ideaPrompt(t.ideas, idea));
        return;
    }
  };

  return (
    <main
      data-testid="ideas-page"
      className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
    >
      <h1 className="text-xl font-semibold">{t.ideas.title}</h1>
      {[...groups.entries()].map(([categoryKey, rows]) => (
        <section key={categoryKey} className="mt-6">
          <h2 className="text-sm font-medium">
            {ideaLabel(t.ideas, categoryKey)}
          </h2>
          <ul className="mt-2 space-y-2">
            {rows.map((idea) => (
              <li
                key={idea.id}
                className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block text-left"
                    onClick={() => letsDoIt(idea)}
                  >
                    <span className="block">
                      {ideaLabel(t.ideas, idea.promiseKey)}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {ideaLabel(t.ideas, idea.howKey)}
                    </span>
                  </button>
                  {scopingId === idea.id && idea.action.kind === 'scoping' ? (
                    <ScopingCard
                      title={t.ideas.letsDoIt}
                      questions={idea.action.questions.map((key) =>
                        ideaLabel(t.ideas, key),
                      )}
                      onSubmit={(answers) =>
                        prefill(scopedPrompt(t.ideas, idea, answers))
                      }
                    />
                  ) : null}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm">⋯</summary>
                  <button
                    type="button"
                    className="block text-sm"
                    onClick={() => letsDoIt(idea)}
                  >
                    {t.ideas.letsDoIt}
                  </button>
                  <button
                    type="button"
                    data-testid={`idea-more-${idea.id}`}
                    className="block text-sm"
                    onClick={() => saveIdeaFeedback(idea.id, 'more')}
                  >
                    {t.ideas.moreLikeThis}
                  </button>
                  <button
                    type="button"
                    data-testid={`idea-dismiss-${idea.id}`}
                    className="block text-sm"
                    onClick={() => saveIdeaFeedback(idea.id, 'dismissed')}
                  >
                    {t.ideas.notInterested}
                  </button>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
