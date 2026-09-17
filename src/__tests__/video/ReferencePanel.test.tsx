import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { ReferencePanel } from '@/components/video/reference/ReferencePanel';
import type { VideoProject } from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          title: 'Analyze video',
          description: 'Study a video file or authorized link.',
          addFile: 'Add local file',
          pathPlaceholder: 'Workspace video path',
          urlPlaceholder: 'User-authorized video URL',
          focusPlaceholder: 'What should this analysis focus on?',
          flagsLoading: 'Checking availability',
          flagsError: 'Could not confirm availability',
          retryFlags: 'Retry',
          empty: 'No reference videos yet.',
          durationOverride: 'Allow references longer than 10 minutes',
          addError: 'Could not add reference: {error}',
        },
      },
    },
  }),
}));

const project = {
  id: 'project-1',
  videoReferences: [],
} as unknown as VideoProject;

describe('ReferencePanel', () => {
  it('allows a local reference file without a rights-acknowledgement checkbox', async () => {
    const user = userEvent.setup();
    const addVideoReference = vi.fn().mockResolvedValue(project);
    const actions = {
      addVideoReference,
    } as unknown as VideoProjectEditorActions;
    const { container } = render(
      <ReferencePanel
        project={project}
        actions={actions}
        flagsLoading={false}
        flagsError={null}
        onRetryFlags={vi.fn()}
      />,
    );

    // The only checkbox on this form is the duration-override control — there
    // is no separate rights-acknowledgement step to add a local file.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.disabled).toBe(false);

    const file = new File(['video'], 'reference.webm', {
      type: 'video/webm',
    });
    await user.upload(input!, file);

    expect(addVideoReference).toHaveBeenCalledWith({
      origin: 'upload',
      file,
      studyAcknowledged: true,
      allowLonger: false,
    });
  });

  it('surfaces a failed link add and keeps the URL for the user to fix', async () => {
    const user = userEvent.setup();
    const addVideoReference = vi
      .fn()
      .mockRejectedValue(
        new Error('References longer than 600s need an explicit override.'),
      );
    const actions = {
      addVideoReference,
    } as unknown as VideoProjectEditorActions;
    render(
      <ReferencePanel
        project={project}
        actions={actions}
        flagsLoading={false}
        flagsError={null}
        onRetryFlags={vi.fn()}
      />,
    );

    const urlInput = screen.getByPlaceholderText('User-authorized video URL');
    await user.type(urlInput, 'https://www.youtube.com/watch?v=ohqxP8EEumo');
    await user.click(
      screen.getByRole('button', { name: 'User-authorized video URL' }),
    );

    expect(
      await screen.findByText(
        'Could not add reference: References longer than 600s need an explicit override.',
      ),
    ).toBeTruthy();
    // The failed value stays put — clearing it on failure is what made the
    // link button look like it just silently reset the panel.
    expect(urlInput).toHaveValue('https://www.youtube.com/watch?v=ohqxP8EEumo');
  });

  it('passes allowLonger through when the override checkbox is checked', async () => {
    const user = userEvent.setup();
    const addVideoReference = vi.fn().mockResolvedValue(project);
    const actions = {
      addVideoReference,
    } as unknown as VideoProjectEditorActions;
    render(
      <ReferencePanel
        project={project}
        actions={actions}
        flagsLoading={false}
        flagsError={null}
        onRetryFlags={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox'));
    const urlInput = screen.getByPlaceholderText('User-authorized video URL');
    await user.type(urlInput, 'https://www.youtube.com/watch?v=ohqxP8EEumo');
    await user.click(
      screen.getByRole('button', { name: 'User-authorized video URL' }),
    );

    expect(addVideoReference).toHaveBeenCalledWith({
      origin: 'link',
      url: 'https://www.youtube.com/watch?v=ohqxP8EEumo',
      studyAcknowledged: true,
      allowLonger: true,
    });
    expect(urlInput).toHaveValue('');
  });
});
