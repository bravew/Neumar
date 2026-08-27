import { createElement, type ReactNode } from 'react';

import { MemoryRouter } from 'react-router-dom';

import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePreviewViewMode } from '@/components/video/preview/usePreviewViewMode';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    MemoryRouter,
    null,
    createElement(LanguageProvider, null, children),
  );

function projectWithRender(
  status: string | undefined,
  updatedAt?: string,
): VideoProject {
  return {
    id: 'project-1',
    name: 'Clip',
    template: 'custom',
    prompt: '',
    assets: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    ...(status ? { render: { status, updatedAt } } : {}),
  } as unknown as VideoProject;
}

describe('usePreviewViewMode', () => {
  beforeEach(() => vi.mocked(toast.success).mockClear());

  it('starts on the live preview', () => {
    const { result } = renderHook(
      () => usePreviewViewMode(projectWithRender(undefined)),
      { wrapper },
    );
    expect(result.current.viewMode).toBe('preview');
  });

  it('switches to the output when a render finishes', () => {
    const { result, rerender } = renderHook(
      ({ project }: { project: VideoProject }) => usePreviewViewMode(project),
      { initialProps: { project: projectWithRender('running') }, wrapper },
    );
    expect(result.current.viewMode).toBe('preview');

    rerender({ project: projectWithRender('done', '2026-08-26T01:00:00Z') });
    expect(result.current.viewMode).toBe('output');
  });

  it('never overrides a view the user chose', () => {
    const { result, rerender } = renderHook(
      ({ project }: { project: VideoProject }) => usePreviewViewMode(project),
      { initialProps: { project: projectWithRender('running') }, wrapper },
    );

    // The user goes back to the timeline mid-render...
    act(() => result.current.onViewModeChange('preview'));
    rerender({ project: projectWithRender('done', '2026-08-26T01:00:00Z') });
    expect(result.current.viewMode).toBe('preview');

    // ...and a second render must not yank them out either.
    rerender({ project: projectWithRender('done', '2026-08-26T02:00:00Z') });
    expect(result.current.viewMode).toBe('preview');
  });

  it('does not leave the output view when a re-render starts', () => {
    const { result, rerender } = renderHook(
      ({ project }: { project: VideoProject }) => usePreviewViewMode(project),
      {
        initialProps: {
          project: projectWithRender('done', '2026-08-26T01:00:00Z'),
        },
        wrapper,
      },
    );
    expect(result.current.viewMode).toBe('output');

    rerender({ project: projectWithRender('running') });
    expect(result.current.viewMode).toBe('output');
  });

  it('opens on the output when arriving from the Export stage', () => {
    const exportWrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        MemoryRouter,
        { initialEntries: ['/video/p?step=preview&stage=export'] },
        createElement(LanguageProvider, null, children),
      );
    const { result } = renderHook(
      () => usePreviewViewMode(projectWithRender(undefined)),
      { wrapper: exportWrapper },
    );
    expect(result.current.viewMode).toBe('output');
  });

  it('announces a render that lands while watching, once', () => {
    const { rerender } = renderHook(
      ({ project }: { project: VideoProject }) => usePreviewViewMode(project),
      { initialProps: { project: projectWithRender('running') }, wrapper },
    );
    expect(toast.success).not.toHaveBeenCalled();

    rerender({ project: projectWithRender('done', '2026-08-26T01:00:00Z') });
    expect(toast.success).toHaveBeenCalledTimes(1);

    // Unrelated re-renders of the same finished render must stay quiet.
    rerender({ project: projectWithRender('done', '2026-08-26T01:00:00Z') });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('stays quiet about a render that finished before mount', () => {
    renderHook(
      ({ project }: { project: VideoProject }) => usePreviewViewMode(project),
      {
        initialProps: {
          project: projectWithRender('done', '2026-08-26T01:00:00Z'),
        },
        wrapper,
      },
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
