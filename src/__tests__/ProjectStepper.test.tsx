import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/layout/sidebar-context';
import { ProjectStepper } from '@/components/video/ProjectStepper';

import { renderWithProviders } from './helpers/render-with-providers';

describe('ProjectStepper', () => {
  it('keeps tab semantics and emits step changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithProviders(
      <SidebarProvider>
        <ProjectStepper value="board" derived="plan" onChange={onChange} />
      </SidebarProvider>,
    );

    expect(screen.getByRole('button', { name: /storyboard/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /plan/i })).toHaveAttribute(
      'aria-current',
      'step',
    );

    await user.click(screen.getByRole('button', { name: /preview/i }));
    expect(onChange).toHaveBeenCalledWith('preview');
  });
});
