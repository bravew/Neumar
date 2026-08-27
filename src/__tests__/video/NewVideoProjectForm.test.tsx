import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createVideoProject } = vi.hoisted(() => ({
  createVideoProject: vi.fn(),
}));

vi.mock('@/shared/hooks/useVideoProject', () => ({ createVideoProject }));

import { NewVideoProjectForm } from '@/components/video/NewVideoProjectForm';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('NewVideoProjectForm', () => {
  beforeEach(() => {
    createVideoProject.mockReset();
    createVideoProject.mockResolvedValue({
      project: { id: 'video-1' },
    });
  });

  it('creates a custom project when no template default is provided', async () => {
    const user = userEvent.setup();

    renderWithProviders(<NewVideoProjectForm onCreated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /create project/i }));

    expect(createVideoProject).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'custom' }),
    );
  });
});
