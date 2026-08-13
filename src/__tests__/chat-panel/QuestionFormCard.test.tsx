import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QuestionFormCard } from '@/components/shared/chat-panel';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      common: {
        questionInput: {
          needsInput: 'Your input is needed',
          other: 'Other',
          customInput: 'Custom response',
          placeholder: 'Type your answer...',
          submit: 'Submit',
        },
      },
      task: {
        answeredQuestion: 'Answered',
      },
    },
  }),
}));

describe('QuestionFormCard', () => {
  it('submits selected answers and custom input', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <QuestionFormCard
        questions={[
          {
            header: 'Cut',
            question: 'Which cut should I use?',
            multiSelect: true,
            options: [{ label: 'A', description: 'Short' }],
          },
        ]}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: /A/ }));
    await user.click(screen.getByRole('button', { name: /Other/ }));
    await user.type(screen.getByPlaceholderText(/type your answer/i), 'B');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      'Which cut should I use?': 'A, B',
    });
  });

  it('renders answered state read-only', () => {
    render(
      <QuestionFormCard
        questions={[
          {
            header: 'Cut',
            question: 'Which cut should I use?',
            multiSelect: false,
            options: [{ label: 'A' }],
          },
        ]}
        onSubmit={vi.fn()}
        answered
        answerText="Use A"
      />,
    );

    expect(screen.getByText('Use A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
  });
});
