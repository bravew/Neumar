import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectViewWorkflowHeader } from '@/components/design/ProjectViewWorkflowHeader';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('ProjectViewWorkflowHeader', () => {
  it('uses the chat brief as the primary action for fresh chat-loop projects', async () => {
    const user = userEvent.setup();
    const onSendProjectPrompt = vi.fn();

    renderHeader({
      project: designProjectFixture({
        brief: { prompt: 'Build a kanban board' },
      }),
      onSendProjectPrompt,
    });

    expect(
      screen.getByRole('button', { name: /send brief/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add assets/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /send brief/i }));

    expect(onSendProjectPrompt).toHaveBeenCalledWith('Build a kanban board');
  });

  it('opens questions when answers are the next useful action', async () => {
    const user = userEvent.setup();
    const onOpenQuestions = vi.fn();

    renderHeader({
      hasOpenQuestions: true,
      onOpenQuestions,
    });

    await user.click(screen.getByRole('button', { name: /answer questions/i }));

    expect(onOpenQuestions).toHaveBeenCalledTimes(1);
  });

  it('stops active chat runs from the header', async () => {
    const user = userEvent.setup();
    const onCancelChat = vi.fn();

    renderHeader({
      chatSending: true,
      onCancelChat,
    });

    await user.click(screen.getByRole('button', { name: /^stop$/i }));

    expect(onCancelChat).toHaveBeenCalledTimes(1);
  });

  it('stops active media tasks from the header', async () => {
    const user = userEvent.setup();
    const onCancelActiveTask = vi.fn(async () => {});

    renderHeader({
      activeTaskId: 'dmtask_1',
      chatLoopActive: false,
      onCancelActiveTask,
    });

    await user.click(screen.getByRole('button', { name: /^stop$/i }));

    expect(onCancelActiveTask).toHaveBeenCalledTimes(1);
  });
});

function renderHeader({
  project = designProjectFixture(),
  chatLoopActive = true,
  hasOpenQuestions = false,
  activeTaskId = null,
  sending = false,
  chatSending = false,
  message = '',
  onMessageChange = vi.fn(),
  onSendProjectPrompt = vi.fn(),
  onFinalizeDesign = vi.fn(async () => {}),
  onOpenProjectFile = vi.fn(),
  onCancelActiveTask = vi.fn(async () => {}),
  onCancelChat = vi.fn(),
  onOpenQuestions = vi.fn(),
}: {
  project?: DesignProject;
  chatLoopActive?: boolean;
  hasOpenQuestions?: boolean;
  activeTaskId?: string | null;
  sending?: boolean;
  chatSending?: boolean;
  message?: string;
  onMessageChange?: (message: string) => void;
  onSendProjectPrompt?: (prompt: string) => void;
  onFinalizeDesign?: () => Promise<void>;
  onOpenProjectFile?: (filePath: string) => void;
  onCancelActiveTask?: () => Promise<void>;
  onCancelChat?: () => void;
  onOpenQuestions?: () => void;
} = {}) {
  renderWithProviders(
    <ProjectViewWorkflowHeader
      project={project}
      chatLoopActive={chatLoopActive}
      hasOpenQuestions={hasOpenQuestions}
      activeTaskId={activeTaskId}
      sending={sending}
      chatSending={chatSending}
      message={message}
      onMessageChange={onMessageChange}
      onSendProjectPrompt={onSendProjectPrompt}
      onFinalizeDesign={onFinalizeDesign}
      onOpenProjectFile={onOpenProjectFile}
      onCancelActiveTask={onCancelActiveTask}
      onCancelChat={onCancelChat}
      onOpenQuestions={onOpenQuestions}
    />,
  );
}

function designProjectFixture(
  overrides: Partial<DesignProject> = {},
): DesignProject {
  return {
    id: 'design_header',
    title: 'Design header',
    surface: 'prototype',
    status: 'ready',
    skillId: null,
    designSystemId: null,
    inspirationDesignSystemIds: [],
    craftRefs: [],
    brief: {},
    outputs: [],
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z',
    ...overrides,
  };
}
