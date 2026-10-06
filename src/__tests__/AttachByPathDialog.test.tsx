import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachByPathDialog } from '@/components/shared/AttachByPathDialog';
import type { LocalPathResult } from '@/components/shared/useChatInputFiles';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      task: {
        attachByPathTitle: 'Attach a file by path',
        attachByPathDescription: 'Enter the full path',
        attachByPathPlaceholder: '/Users/you/clip.mp4',
        attachByPathSubmit: 'Attach',
      },
    },
    tt: (key: string, params?: Record<string, string>) =>
      `${key}:${params?.path ?? ''}`,
  }),
}));

function setup(onAttach: (paths: string[]) => Promise<LocalPathResult[]>) {
  const onOpenChange = vi.fn();
  render(
    <AttachByPathDialog open onOpenChange={onOpenChange} onAttach={onAttach} />,
  );
  const input = screen.getByTestId('attach-by-path-input');
  return { onOpenChange, input };
}

describe('AttachByPathDialog', () => {
  it('attaches the typed path, normalised, and closes', async () => {
    const onAttach = vi
      .fn()
      .mockResolvedValue([{ path: '/Users/me/My Movies/a.mp4' }]);
    const { onOpenChange, input } = setup(onAttach);

    fireEvent.change(input, {
      target: { value: '"/Users/me/My Movies/a.mp4"' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onAttach).toHaveBeenCalledWith(['/Users/me/My Movies/a.mp4']);
  });

  it('shows why a path failed, keeps it for editing, and stays open', async () => {
    const onAttach = vi
      .fn()
      .mockResolvedValue([{ path: '/Users/me/gone.mp4', reason: 'not_found' }]);
    const { onOpenChange, input } = setup(onAttach);

    fireEvent.change(input, { target: { value: '/Users/me/gone.mp4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'task.attachByPathNotFound:/Users/me/gone.mp4',
    );
    expect(input).toHaveValue('/Users/me/gone.mp4');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('rejects text that is not a path without calling the API', async () => {
    const onAttach = vi.fn().mockResolvedValue([]);
    const { input } = setup(onAttach);

    fireEvent.change(input, { target: { value: 'clip.mp4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'task.attachByPathNotFound:clip.mp4',
    );
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('retries only the lines that failed so nothing attaches twice', async () => {
    const onAttach = vi
      .fn()
      .mockResolvedValue([
        { path: '/Users/me/a.mp4' },
        { path: '/Users/me/gone.mp4', reason: 'not_found' },
      ]);
    const { input } = setup(onAttach);

    fireEvent.change(input, {
      target: { value: '/Users/me/a.mp4\n/Users/me/gone.mp4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() => expect(input).toHaveValue('/Users/me/gone.mp4'));
  });
});
