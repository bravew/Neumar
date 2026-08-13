import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditorHandoffExport } from '@/components/video/preview/EditorHandoffExport';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('EditorHandoffExport', () => {
  it('renders branded target icons with the editor labels', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <EditorHandoffExport
        onGetJob={vi.fn().mockResolvedValue(null)}
        onQueue={vi.fn().mockResolvedValue(null)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /editor handoff/i }));

    const targets = [
      ['Final Cut Pro', 'final-cut-pro'],
      ['Premiere Pro', 'premiere-pro'],
      ['DaVinci Resolve', 'resolve'],
      ['OTIO', 'otio'],
      ['EDL', 'edl'],
      ['CapCut fallback', 'capcut-fallback'],
    ] as const;

    for (const [label, target] of targets) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(
        screen.getByTestId(`handoff-target-icon-${target}`),
      ).toBeInTheDocument();
    }
  });
});
