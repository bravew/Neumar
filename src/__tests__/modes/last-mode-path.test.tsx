import { act } from 'react';

import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetModePathsForTests } from '@/shared/modes/lastModePath';
import { ModeProvider } from '@/shared/modes/ModeProvider';
import { useMode } from '@/shared/modes/useMode';
import '@/shared/modes/modes.builtin';

let select: (id: string) => void = () => {};

function Probe() {
  const { setActiveMode } = useMode();
  select = setActiveMode;
  return null;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ModeProvider>
            <Probe />
          </ModeProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  const go = (to: string) => act(() => router.navigate(to));
  const choose = (id: string) =>
    act(() => {
      select(id);
    });
  const at = () => router.state.location.pathname;
  return { router, go, choose, at };
}

describe('mode switching resumes where the user left', () => {
  beforeEach(() => {
    resetModePathsForTests();
  });

  it('returns to the open conversation after another mode', async () => {
    const { choose, at } = renderAt('/task-v2/abc');
    await choose('video');
    expect(at()).toBe('/video');
    await choose('tasks');
    expect(at()).toBe('/task-v2/abc');
  });

  it('returns to the open video project', async () => {
    const { go, choose, at } = renderAt('/video/p1');
    await go('/task-v2/abc');
    await choose('video');
    expect(at()).toBe('/video/p1');
  });

  it('resumes the conversation from Library, which Tasks also matches', async () => {
    const { go, choose, at } = renderAt('/task-v2/abc');
    await go('/library');
    await choose('tasks');
    expect(at()).toBe('/task-v2/abc');
  });

  it('goes to the root when the mode is already open', async () => {
    const { choose, at } = renderAt('/task-v2/abc');
    await choose('tasks');
    expect(at()).toBe('/');
  });

  it('carries an unsent first prompt back to the task page', async () => {
    const { router, choose } = renderAt('/');
    await act(() =>
      router.navigate('/task-v2/new', { state: { prompt: 'count to 5' } }),
    );
    await choose('video');
    await choose('tasks');
    expect(router.state.location.pathname).toBe('/task-v2/new');
    expect(router.state.location.state).toEqual({ prompt: 'count to 5' });

    // Once the page clears the prompt, a later return carries nothing.
    await act(() =>
      router.navigate('/task-v2/new', { replace: true, state: null }),
    );
    await choose('video');
    await choose('tasks');
    expect(router.state.location.state).toBeNull();
  });

  it('forgets a deleted task', async () => {
    const { choose, at } = renderAt('/task-v2/abc');
    await choose('video');
    act(() => {
      window.dispatchEvent(
        new CustomEvent('sidebar-task-deleted', { detail: 'abc' }),
      );
    });
    await choose('tasks');
    expect(at()).toBe('/');
  });
});
