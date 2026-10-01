import { AsyncList } from '@/components/common/async-list';
import type { AsyncListStatus } from '@/components/common/async-list';
import { ScopingCard } from '@/components/ideas/ScopingCard';
import { useLanguage } from '@/shared/providers/language-provider';
import type { Automation } from '@/shared/types/automation';

import { partitionAutomations } from './partition-automations';

const CATEGORIES = [
  'reports',
  'monitoring',
  'files',
  'publishing',
  'somethingElse',
] as const;

export function OutcomeAutomationLists({
  automations,
  status,
  onSelect,
}: {
  automations: Automation[];
  status: AsyncListStatus;
  onSelect: (automation: Automation) => void;
}) {
  const { t } = useLanguage();
  const labels = t.automation as unknown as Record<string, string>;
  const lists = partitionAutomations(automations);
  const questions = [
    labels.questionOutcome ?? 'What should happen?',
    labels.questionWhen ?? 'When should it run?',
    labels.questionWhere ?? 'Where should the result go?',
  ] as const;

  const openCategory = (category: string) => {
    window.dispatchEvent(new CustomEvent('shell:open-dock'));
    window.dispatchEvent(
      new CustomEvent('automation:scope', {
        detail: { category, questions: [...questions] },
      }),
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t.automation.title}</h1>
      {(['scheduled', 'watching', 'paused'] as const).map((name) => (
        <section key={name}>
          <h2 className="text-sm font-medium">{labels[name]}</h2>
          <AsyncList
            status={status}
            empty={lists[name].length === 0}
            renderSkeleton={() => <p className="text-sm">{t.common.loading}</p>}
            renderEmpty={() => (
              <p className="text-muted-foreground text-sm">
                {labels.emptyList}
              </p>
            )}
            renderError={() => (
              <p className="text-destructive text-sm">
                {t.automation.errors.generic}
              </p>
            )}
          >
            <ul>
              {lists[name].map((automation) => (
                <li
                  key={automation.id}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-sm">{automation.name}</span>
                  <button
                    type="button"
                    className="text-xs"
                    onClick={() => onSelect(automation)}
                  >
                    {labels.editDetails}
                  </button>
                </li>
              ))}
            </ul>
          </AsyncList>
        </section>
      ))}
      <section>
        <h2 className="mb-2 text-sm font-medium">{labels.createAutomation}</h2>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              data-testid={`automation-category-${category}`}
              className="rounded-full border px-3 py-1 text-sm"
              onClick={() => openCategory(category)}
            >
              {labels[category]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AutomationScope({
  questions,
  title,
  onSubmit,
}: {
  questions: readonly string[];
  title: string;
  onSubmit: (answers: string[]) => void;
}) {
  return (
    <ScopingCard
      title={title}
      questions={questions.slice(0, 3)}
      onSubmit={onSubmit}
    />
  );
}
