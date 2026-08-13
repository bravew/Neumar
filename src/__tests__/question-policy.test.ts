import { describe, expect, it } from 'vitest';

import {
  defaultQuestionAnswers,
  normalizeAgentQuestions,
} from '@/shared/questions/question-policy';

const BASE_QUESTION = {
  question: 'Which direction?',
  header: 'Direction',
  options: [{ label: 'Calm' }, { label: 'Bold' }],
};

describe('question policy normalization', () => {
  it.each([
    undefined,
    { behavior: 'optional', defaultOptionLabel: 'Missing' },
    {
      behavior: 'optional',
      gate: 'unknown',
      defaultOptionLabel: 'Calm',
    },
  ])('fails missing or invalid policy closed', (policy) => {
    const questions = normalizeAgentQuestions({
      questions: [{ ...BASE_QUESTION, policy }],
    });
    expect(questions[0].policy).toEqual({ behavior: 'manual' });
    expect(defaultQuestionAnswers(questions)).toBeNull();
  });

  it('returns declared defaults only when every question is optional', () => {
    const questions = normalizeAgentQuestions({
      questions: [
        {
          ...BASE_QUESTION,
          policy: { behavior: 'optional', defaultOptionLabel: 'Calm' },
        },
      ],
    });
    expect(defaultQuestionAnswers(questions)).toEqual({
      'Which direction?': 'Calm',
    });
  });
});
