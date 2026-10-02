import { Library, ListChecks, Mail, PenLine } from 'lucide-react';

import type { IdeaDefinition } from './types';

const SEED: IdeaDefinition[] = [
  {
    id: 'draft-email',
    categoryKey: 'ideas.category.write',
    promiseKey: 'ideas.promise.draftEmail',
    howKey: 'ideas.how.draftEmail',
    icon: Mail,
    action: { kind: 'prefill', promptKey: 'ideas.prompt.draftEmail' },
  },
  {
    id: 'build-feature',
    categoryKey: 'ideas.category.code',
    promiseKey: 'ideas.promise.buildFeature',
    howKey: 'ideas.how.buildFeature',
    icon: PenLine,
    action: { kind: 'prefill', promptKey: 'ideas.prompt.buildFeature' },
  },
  {
    id: 'weekly-report',
    categoryKey: 'ideas.category.plan',
    promiseKey: 'ideas.promise.weeklyReport',
    howKey: 'ideas.how.weeklyReport',
    icon: ListChecks,
    action: {
      kind: 'scoping',
      questions: [
        'ideas.question.audience',
        'ideas.question.period',
        'ideas.question.format',
      ],
    },
    requires: 'schedule',
  },
  {
    id: 'browse-library',
    categoryKey: 'ideas.category.plan',
    promiseKey: 'ideas.promise.browseLibrary',
    howKey: 'ideas.how.browseLibrary',
    icon: Library,
    action: { kind: 'nav', path: '/library' },
  },
];

const registered: IdeaDefinition[] = [];

export function registerIdeas(ideas: IdeaDefinition[]) {
  for (const idea of ideas) {
    if (registered.some((existing) => existing.id === idea.id)) continue;
    registered.push(idea);
  }
}

export function listIdeas(): IdeaDefinition[] {
  return [...SEED, ...registered];
}
