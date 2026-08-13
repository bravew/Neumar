import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DesignNextStepCard } from '@/components/design/DesignNextStepCard';
import type { DesignChatTurn } from '@/shared/hooks/useDesignChat';

import { renderWithProviders } from './helpers/render-with-providers';

describe('DesignNextStepCard', () => {
  it('seeds a follow-up prompt after a completed artifact run', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    renderWithProviders(
      <DesignNextStepCard
        surface="prototype"
        turns={[doneAssistantTurn()]}
        hasOpenQuestions={false}
        sending={false}
        artifactFile="index.html"
        onPick={onPick}
      />,
    );

    expect(screen.getByTestId('design-next-step-card')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /make it responsive/i }),
    );
    expect(onPick).toHaveBeenCalledWith('Make it responsive');
  });
});

function doneAssistantTurn(): DesignChatTurn {
  return {
    id: 'turn_1',
    role: 'assistant',
    text: 'Done',
    tools: [],
    questions: [],
    questionsStreaming: false,
    status: 'done',
  };
}
