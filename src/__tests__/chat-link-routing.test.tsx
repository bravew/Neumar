import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectChatSidebar } from '@/components/design/ProjectChatSidebar';
import type {
  DesignProject,
  DesignTaskRecord,
} from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('Design chat in-project file links', () => {
  it('routes relative file links to the workspace and leaves external links to link safety', async () => {
    const user = userEvent.setup();
    const onProjectFileOpen = vi.fn();
    renderWithProviders(
      <ProjectChatSidebar
        activeTaskId={null}
        chatPanelWidth={360}
        juryError={null}
        juryRun={null}
        message=""
        project={projectFixture}
        queuedSends={[]}
        sendError={null}
        sending={false}
        tasks={[taskFixture]}
        onBriefSubmit={vi.fn()}
        onCancelActiveTask={vi.fn()}
        onEditQueuedSend={vi.fn()}
        onMessageChange={vi.fn()}
        onRemoveQueuedSend={vi.fn()}
        onProjectFileOpen={onProjectFileOpen}
        onSampleSelected={vi.fn()}
        onSend={vi.fn()}
        onSendQueuedNow={vi.fn()}
        onAnswerQuestion={vi.fn()}
        onWidthChange={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('link', { name: /preview/i }));
    expect(onProjectFileOpen).toHaveBeenCalledWith('artifacts/index.html');

    await user.click(screen.getByRole('link', { name: /external/i }));
    expect(onProjectFileOpen).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByText(/open external link/i)).toBeInTheDocument(),
    );
  });
});

const projectFixture = {
  id: 'design_chat_links',
  title: 'Chat links',
  surface: 'prototype',
  status: 'draft',
  skillId: null,
  designSystemId: null,
  inspirationDesignSystemIds: [],
  craftRefs: [],
  brief: {},
  outputs: [],
  createdAt: '2026-05-24T00:00:00.000Z',
  updatedAt: '2026-05-24T00:00:00.000Z',
} satisfies DesignProject;

const taskFixture = {
  taskId: 'task_links',
  projectId: projectFixture.id,
  surface: 'document',
  model: 'design',
  state: 'done',
  startedAt: '2026-05-24T00:00:00.000Z',
  progressLines: [
    'Open [preview](artifacts/index.html) or [external](https://example.com).',
  ],
  providerError: null,
} satisfies DesignTaskRecord;
