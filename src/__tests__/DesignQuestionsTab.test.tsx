import { StrictMode } from 'react';

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignQuestionsPane } from '@/components/design/DesignQuestionsPane';
import { ProjectChatSidebar } from '@/components/design/ProjectChatSidebar';
import type { AgentQuestion } from '@/shared/hooks/agent-types';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

const OPTIONAL_QUESTION: AgentQuestion = {
  question: 'What visual style fits best?',
  header: 'Style',
  options: [
    { label: 'Minimal', description: 'Clean and restrained' },
    { label: 'Bold', description: 'High contrast' },
  ],
  multiSelect: false,
  policy: { behavior: 'optional', defaultOptionLabel: 'Minimal' },
};

const REQUIRED_QUESTION: AgentQuestion = {
  ...OPTIONAL_QUESTION,
  question: 'Approve the additional image cost?',
  header: 'Cost',
  policy: { behavior: 'manual', gate: 'cost' },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('DesignQuestionsPane policy', () => {
  it('auto-continues an optional question with its declared default', () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    renderWithProviders(
      <DesignQuestionsPane
        questions={[OPTIONAL_QUESTION]}
        streaming={false}
        onAnswer={onAnswer}
      />,
    );

    expect(screen.getByText(/Auto-continues in 1:30/)).toBeVisible();
    act(() => vi.advanceTimersByTime(90_000));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(
      'What visual style fits best? → Minimal',
    );
  });

  it('requires a manual answer for mandatory gates', () => {
    const onAnswer = vi.fn();
    renderWithProviders(
      <DesignQuestionsPane
        questions={[REQUIRED_QUESTION]}
        streaming={false}
        onAnswer={onAnswer}
      />,
    );

    expect(
      screen.getByText('A manual answer is required to continue.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skip all' })).toBeNull();
    fireEvent.click(screen.getByText('Minimal'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('submits at most once when a manual action races the timer in StrictMode', () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    renderWithProviders(
      <StrictMode>
        <DesignQuestionsPane
          questions={[OPTIONAL_QUESTION]}
          streaming={false}
          onAnswer={onAnswer}
        />
      </StrictMode>,
    );

    act(() => vi.advanceTimersByTime(89_000));
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
    act(() => vi.advanceTimersByTime(2_000));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('cancels the optional timer when the current question set becomes manual', () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    const view = renderWithProviders(
      <DesignQuestionsPane
        questions={[OPTIONAL_QUESTION]}
        streaming={false}
        onAnswer={onAnswer}
      />,
    );

    act(() => vi.advanceTimersByTime(30_000));
    view.rerender(
      <DesignQuestionsPane
        questions={[REQUIRED_QUESTION]}
        streaming={false}
        onAnswer={onAnswer}
      />,
    );
    act(() => vi.advanceTimersByTime(90_000));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(
      screen.getByText('A manual answer is required to continue.'),
    ).toBeVisible();
  });
});

describe('ProjectChatSidebar Questions tab', () => {
  function renderSidebar(
    questions: AgentQuestion[] = [],
    onAnswerQuestion = vi.fn(),
  ) {
    renderWithProviders(
      <ProjectChatSidebar
        activeTaskId={null}
        chatPanelWidth={360}
        juryError={null}
        juryRun={null}
        message=""
        project={projectFixture}
        queuedSends={[]}
        questions={questions}
        questionsStreaming={false}
        sendError={null}
        sending={false}
        tasks={[]}
        onBriefSubmit={vi.fn()}
        onCancelActiveTask={vi.fn()}
        onEditQueuedSend={vi.fn()}
        onMessageChange={vi.fn()}
        onRemoveQueuedSend={vi.fn()}
        onSampleSelected={vi.fn()}
        onSend={vi.fn()}
        onSendQueuedNow={vi.fn()}
        onAnswerQuestion={onAnswerQuestion}
        onWidthChange={vi.fn()}
      />,
    );
    return onAnswerQuestion;
  }

  it('shows an empty state when there are no questions', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
    expect(screen.getByText('No open questions right now.')).toBeVisible();
  });

  it('renders normalized question data and submits an answer', () => {
    const onAnswerQuestion = renderSidebar([OPTIONAL_QUESTION]);
    fireEvent.click(screen.getByRole('tab', { name: /Questions/ }));
    fireEvent.click(screen.getByText('Bold'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onAnswerQuestion).toHaveBeenCalledWith(
      'What visual style fits best? → Bold',
    );
  });
});

const projectFixture = {
  id: 'design_test',
  title: 'Questions tab',
  surface: 'prototype',
  status: 'draft',
  skillId: null,
  designSystemId: null,
  inspirationDesignSystemIds: [],
  craftRefs: [],
  brief: {},
  outputs: [],
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
} satisfies DesignProject;
