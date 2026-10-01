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

export type IdeasFeedback = Record<string, 'dismissed'>;

export function visibleIdeas(
  ideas: IdeaDefinition[],
  feedback: IdeasFeedback | undefined,
): IdeaDefinition[] {
  return ideas.filter((idea) => feedback?.[idea.id] !== 'dismissed');
}
