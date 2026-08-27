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
        <ProjectStepper value="board" onChange={onChange} />
      </SidebarProvider>,
    );

    // The displayed canvas is both selected and current. Previously
    // `aria-current` came from derived progress, so assistive tech announced
    // Plan as current while Storyboard was on screen.
    const storyboard = screen.getByRole('button', { name: /storyboard/i });
    expect(storyboard).toHaveAttribute('aria-pressed', 'true');
    expect(storyboard).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: /^plan$/i })).not.toHaveAttribute(
      'aria-current',
    );

    await user.click(screen.getByRole('button', { name: /preview/i }));
    expect(onChange).toHaveBeenCalledWith('preview');
  });
});
