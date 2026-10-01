import type { ComponentType } from 'react';

export type IdeaCategory = 'write' | 'code' | 'plan';

export type ScopingQuestions =
  | readonly []
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string];

export type IdeaAction =
  | { kind: 'prefill'; promptKey: string }
  | { kind: 'nav'; path: string }
  | { kind: 'scoping'; questions: ScopingQuestions };

export interface IdeaDefinition {
  id: string;
  categoryKey: `ideas.category.${IdeaCategory}`;
  promiseKey: string;
  howKey: string;
  icon: ComponentType<{ className?: string }>;
  action: IdeaAction;
  requires?: 'connector' | 'schedule';
}

/** `dismissed` hides an idea; `more` (More like this) ranks it first. */
export type IdeaFeedback = 'dismissed' | 'more';

export type IdeasFeedback = Record<string, IdeaFeedback>;

export function visibleIdeas(
  ideas: IdeaDefinition[],
  feedback: IdeasFeedback | undefined,
): IdeaDefinition[] {
  const shown = ideas.filter((idea) => feedback?.[idea.id] !== 'dismissed');
  // Array.prototype.sort is stable, so registry order holds within each tier.
  return shown.sort(
    (a, b) =>
      Number(feedback?.[b.id] === 'more') - Number(feedback?.[a.id] === 'more'),
  );
}
