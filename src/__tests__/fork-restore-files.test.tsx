import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageToolbar } from '@/components/task/MessageToolbar';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import { UserMessageBubble } from '@/components/task/UserMessageBubble';
import {
  createBranch,
  RestoreFilesError,
  restoreFilesToForkPoint,
} from '@/shared/db/database';
import { useBranchActions } from '@/shared/hooks/useBranchActions';
import { hasCheckpointedFileEditsAfter } from '@/shared/lib/message-tree';

import { renderWithProviders } from './helpers/render-with-providers';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/shared/db/database', () => ({
  RestoreFilesError: class RestoreFilesError extends Error {
    constructor(
      message: string,
      readonly filesChanged: string[],
    ) {
      super(message);
    }
  },
  createBranch: vi.fn().mockResolvedValue('branch-1'),
  createEditBranch: vi.fn(),
  getMessagesByTaskId: vi.fn().mockResolvedValue([]),
  regenerateResponse: vi.fn(),
  restoreFilesToForkPoint: vi.fn(),
}));

vi.mock('@/shared/stores/branch-store', () => ({
  useBranchStore: Object.assign(
    vi.fn(() => ({
      addBranch: vi.fn(),
      setActiveBranch: vi.fn(),
      selectBranchAtFork: vi.fn(),
    })),
    { getState: () => ({ taskBranches: {} }) },
  ),
}));

function toolCall(name: string) {
  return {
    id: `tc-${name}`,
    type: 'function' as const,
    function: { name, arguments: '{}' },
  };
}

const messages: AGUIMessage[] = [
  { id: 'u1', role: 'user', content: 'Build it' },
  { id: 'a1', role: 'assistant', content: 'Plan' },
  { id: 'a2', role: 'assistant', content: '', toolCalls: [toolCall('Bash')] },
  { id: 'a3', role: 'assistant', content: '', toolCalls: [toolCall('Edit')] },
  { id: 'a4', role: 'assistant', content: 'Done' },
];

describe('Fork and restore files visibility', () => {
  it('is offered only when a checkpointed file edit follows the fork point', () => {
    expect(hasCheckpointedFileEditsAfter(messages, 'a1')).toBe(true);
    // Bash is not checkpointed, and nothing edits files after the last reply.
    expect(hasCheckpointedFileEditsAfter(messages, 'a3')).toBe(false);
    expect(hasCheckpointedFileEditsAfter(messages, 'a4')).toBe(false);
    expect(hasCheckpointedFileEditsAfter(messages, 'missing')).toBe(false);
  });

  it('renders the action only when provided and confirms before restoring', () => {
    const onForkRestoreFiles = vi.fn();
    const { rerender } = renderWithProviders(
      <MessageToolbar content="Plan" onFork={vi.fn()} />,
    );
    expect(
      screen.queryByRole('button', { name: /fork and restore files/i }),
    ).toBeNull();

    rerender(
      <MessageToolbar
        content="Plan"
        onFork={vi.fn()}
        onForkRestoreFiles={onForkRestoreFiles}
      />,
    );
    const button = screen.getByRole('button', {
      name: /fork and restore files/i,
    });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Bash/));
    expect(onForkRestoreFiles).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(button);
    expect(onForkRestoreFiles).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it.each([
    [[], /not forked/i],
    [['a.ts', 'b.ts'], /partly restored.*a\.ts, b\.ts/i],
  ])(
    'tells the user when the restore failed (already restored: %j)',
    async (filesChanged, message) => {
      const onForkRestoreFiles = vi
        .fn()
        .mockResolvedValue({ ok: false, filesChanged });
      renderWithProviders(
        <MessageToolbar
          content="Plan"
          onForkRestoreFiles={onForkRestoreFiles}
        />,
      );
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /fork and restore files/i }),
        );
      });

      expect(toast.error).toHaveBeenLastCalledWith(
        expect.stringMatching(message),
      );
    },
  );
});

describe('useBranchActions fork with file restore', () => {
  const refs = () =>
    [
      { current: { messages: [] } },
      { current: 'task-1' },
      { current: undefined },
      { current: undefined },
      { current: undefined },
    ] as unknown as Parameters<typeof useBranchActions>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plain fork leaves files alone', async () => {
    const { result } = renderHook(() => useBranchActions(...refs()));
    await act(async () => {
      await expect(result.current.handleForkFromHere('a1')).resolves.toEqual({
        ok: true,
      });
    });

    expect(restoreFilesToForkPoint).not.toHaveBeenCalled();
    expect(createBranch).toHaveBeenCalledWith('task-1', 'a1');
  });

  it('restores files before forking', async () => {
    vi.mocked(restoreFilesToForkPoint).mockResolvedValueOnce({
      rewoundRuns: 1,
      filesChanged: ['a.ts'],
    });
    const { result } = renderHook(() => useBranchActions(...refs()));
    await act(() =>
      result.current.handleForkFromHere('a1', { restoreFiles: true }),
    );

    expect(restoreFilesToForkPoint).toHaveBeenCalledWith('task-1', 'a1');
    expect(createBranch).toHaveBeenCalledWith('task-1', 'a1');
    expect(
      vi.mocked(restoreFilesToForkPoint).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(createBranch).mock.invocationCallOrder[0]!);
  });

  it('does not fork when the restore fails, and reports files already restored', async () => {
    vi.mocked(restoreFilesToForkPoint).mockRejectedValueOnce(
      new RestoreFilesError('timed out', ['newer.ts']),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useBranchActions(...refs()));
    await act(async () => {
      await expect(
        result.current.handleForkFromHere('a1', { restoreFiles: true }),
      ).resolves.toEqual({ ok: false, filesChanged: ['newer.ts'] });
    });

    expect(createBranch).not.toHaveBeenCalled();
  });
});

describe('editing a user message refills its text', () => {
  it('opens the editor prefilled with the original message', () => {
    renderWithProviders(
      <UserMessageBubble
        messageId="u1"
        content="Original prompt"
        onEditMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

    expect(screen.getByRole('textbox')).toHaveValue('Original prompt');
  });
});
