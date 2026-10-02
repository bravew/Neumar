import { getSettings, saveSettings } from '@/shared/db/settings';

import type { IdeaDefinition, IdeaFeedback } from './types';

type Messages = { [key: string]: unknown };

/** Resolves an `ideas.*` key against the ideas locale module. */
export function ideaLabel(messages: Messages, key: string): string {
  const parts = key.split('.').slice(1);
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : key;
}

/** Prompt for a prefill idea; empty for nav and scoping ideas. */
export function ideaPrompt(messages: Messages, idea: IdeaDefinition): string {
  if (idea.action.kind !== 'prefill') return '';
  const prompt = ideaLabel(messages, idea.action.promptKey);
  return prompt === idea.action.promptKey ? '' : prompt;
}

/**
 * Prompt from a scoping card. It keeps the idea's promise and each question
 * so the agent sees what the answers refer to; blank answers are left out.
 */
export function scopedPrompt(
  messages: Messages,
  idea: IdeaDefinition,
  answers: string[],
): string {
  if (idea.action.kind !== 'scoping') return '';
  const lines = idea.action.questions.flatMap((key, index) => {
    const answer = answers[index]?.trim();
    return answer ? [`${ideaLabel(messages, key)} ${answer}`] : [];
  });
  return [ideaLabel(messages, idea.promiseKey), ...lines].join('\n');
}

export function saveIdeaFeedback(id: string, value: IdeaFeedback) {
  const current = getSettings();
  saveSettings({
    ...current,
    ui: {
      ...current.ui,
      ideasFeedback: { ...current.ui.ideasFeedback, [id]: value },
    },
  });
}
