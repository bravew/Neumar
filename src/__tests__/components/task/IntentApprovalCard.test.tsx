import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntentApprovalCard } from '@/components/task/IntentApprovalCard';
import { TaskThreadActions } from '@/components/task/task-thread-actions';
import type { PermissionRequest } from '@/shared/hooks/agent-types';

import { renderWithProviders } from '../../helpers/render-with-providers';

const permission: PermissionRequest = {
  id: 'perm-1',
  tool: 'Bash',
  command: '/sessions/demo/output/run.sh',
  description: 'Run the export script',
};

function renderCard(
  respondToPermission: (
    id: string,
    decision: 'allow' | 'deny' | 'always_allow',
  ) => void,
  sendMessage = vi.fn(),
) {
  return renderWithProviders(
    <TaskThreadActions
      sessionRoot="/sessions/demo"
      respondToPermission={respondToPermission}
      sendMessage={sendMessage}
    >
      <IntentApprovalCard permission={permission} />
    </TaskThreadActions>,
  );
}

describe('IntentApprovalCard', () => {
  it('approves through the existing allow handler', () => {
    const respond = vi.fn();
    renderCard(respond);

    expect(
      screen.getByText('/sessions/demo/output/run.sh'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(respond).toHaveBeenCalledWith('perm-1', 'allow');
  });

  it('denies through the existing deny handler', () => {
    const respond = vi.fn();
    renderCard(respond);

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(respond).toHaveBeenCalledWith('perm-1', 'deny');
  });

  it('sends an edited command and denies the original request', () => {
    const respond = vi.fn();
    const sendMessage = vi.fn();
    renderCard(respond, sendMessage);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit' }), {
      target: { value: 'ls output' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(respond).toHaveBeenCalledWith('perm-1', 'deny');
    expect(sendMessage).toHaveBeenCalledWith('ls output');
  });

  it('does not offer edit when the request has no command', () => {
    renderWithProviders(
      <TaskThreadActions respondToPermission={vi.fn()} sendMessage={vi.fn()}>
        <IntentApprovalCard
          permission={{
            id: 'perm-2',
            tool: 'Read',
            description: 'Read a file',
          }}
        />
      </TaskThreadActions>,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Medium Risk')).toBeInTheDocument();
  });

  it('can leave edit mode without sending', () => {
    const respond = vi.fn();
    const sendMessage = vi.fn();
    renderCard(respond, sendMessage);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit' }), {
      target: { value: 'ls output' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith('perm-1', 'allow');
  });
});
