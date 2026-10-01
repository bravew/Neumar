import { useState } from 'react';

import { Navigate, useNavigate } from 'react-router-dom';

import {
  getSettings,
  saveSettings,
  useSettingsValue,
} from '@/shared/db/settings';
import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas, type IdeaDefinition } from '@/shared/ideas/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { ScopingCard } from './ScopingCard';

export function IdeasPage() {
  const simpleShell = useSettingsValue().ui.simpleShell;
  const feedback = useSettingsValue().ui.ideasFeedback;
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [scopingId, setScopingId] = useState<string | null>(null);
  if (!simpleShell) return <Navigate to="/" replace />;

  const ideas = visibleIdeas(listIdeas(), feedback);
  const groups = new Map<string, IdeaDefinition[]>();
  for (const idea of ideas) {
    const list = groups.get(idea.categoryKey) ?? [];
    list.push(idea);
    groups.set(idea.categoryKey, list);
  }

  const dismiss = (id: string) => {
    const current = getSettings();
    saveSettings({
      ...current,
      ui: {
        ...current.ui,
        ideasFeedback: { ...current.ui.ideasFeedback, [id]: 'dismissed' },
      },
    });
  };

  const letsDoIt = (idea: IdeaDefinition) => {
    if (idea.action.kind === 'nav') {
      navigate(idea.action.path);
      return;
    }
    if (idea.action.kind === 'scoping') {
      setScopingId(idea.id);
      return;
    }
    const messages = t.ideas as unknown as { prompt: Record<string, string> };
    const key = idea.action.promptKey.split('.').pop() ?? '';
    window.dispatchEvent(
      new CustomEvent('ideas:prefill', {
        detail: { prompt: messages.prompt[key] ?? '' },
      }),
    );
    navigate('/');
  };

  return (
    <main
      data-testid="ideas-page"
      className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
    >
      <h1 className="text-xl font-semibold">{t.ideas.title}</h1>
      {[...groups.entries()].map(([categoryKey, rows]) => (
        <section key={categoryKey} className="mt-6">
          <h2 className="text-sm font-medium">{label(t.ideas, categoryKey)}</h2>
          <ul className="mt-2 space-y-2">
            {rows.map((idea) => (
              <li
                key={idea.id}
                className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div>
                  <p>{label(t.ideas, idea.promiseKey)}</p>
                  <p className="text-muted-foreground text-xs">
                    {label(t.ideas, idea.howKey)}
                  </p>
                  {scopingId === idea.id && idea.action.kind === 'scoping' ? (
                    <ScopingCard
                      title={t.ideas.letsDoIt}
                      questions={idea.action.questions.map((key) =>
                        label(t.ideas, key),
                      )}
                      onSubmit={(answers) => {
                        window.dispatchEvent(
                          new CustomEvent('ideas:prefill', {
                            detail: {
                              prompt: answers.filter(Boolean).join('\n'),
                            },
                          }),
                        );
                        navigate('/');
                      }}
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
                    className="block text-sm"
                    onClick={() => letsDoIt(idea)}
                  >
                    {t.ideas.moreLikeThis}
                  </button>
                  <button
                    type="button"
                    data-testid={`idea-dismiss-${idea.id}`}
                    className="block text-sm"
                    onClick={() => dismiss(idea.id)}
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

function label(messages: { [key: string]: unknown }, key: string): string {
  const parts = key.split('.').slice(1);
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : key;
}
