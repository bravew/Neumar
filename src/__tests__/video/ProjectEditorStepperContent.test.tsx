import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectStepperLeading } from '@/components/video/ProjectEditorStepperContent';
import type { VideoProject } from '@/shared/types/video';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('ProjectStepperLeading', () => {
  it('offers an inline project-title editor', async () => {
    const user = userEvent.setup();
    let resolveRename: (() => void) | undefined;
    const onRename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        }),
    );
    renderWithProviders(
      <ProjectStepperLeading project={projectFixture()} onRename={onRename} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Rename video project' }),
    );

    expect(
      screen.getByRole('textbox', { name: 'Rename video project' }),
    ).toHaveValue('Untitled video');

    await user.clear(
      screen.getByRole('textbox', { name: 'Rename video project' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Rename video project' }),
      'Match cut',
    );
    const input = screen.getByRole('textbox', {
      name: 'Rename video project',
    });
    await user.keyboard('{Enter}');
    fireEvent.blur(input);

    expect(onRename).toHaveBeenCalledWith('Match cut');
    expect(onRename).toHaveBeenCalledTimes(1);

    await act(async () => resolveRename?.());
  });
});

function projectFixture(): VideoProject {
  const now = '2026-05-19T02:43:54.812Z';
  return {
    id: 'video_title',
    name: 'Untitled video',
    template: 'slideshow',
    prompt: '',
    assets: [],
    render: { status: 'idle', updatedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}
