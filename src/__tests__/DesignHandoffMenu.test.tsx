import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignHandoffMenu } from '@/components/design/DesignHandoffMenu';

import { renderWithProviders } from './helpers/render-with-providers';

const designModeMock = vi.hoisted(() => ({
  getDesignProjectDir: vi.fn(),
  listDesignEditors: vi.fn(),
  openDesignInEditor: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('@/shared/hooks/useDesignMode', () => designModeMock);

vi.mock('sonner', () => ({
  toast: toastMock,
}));

describe('DesignHandoffMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    designModeMock.getDesignProjectDir.mockReset();
    designModeMock.listDesignEditors.mockReset();
    designModeMock.openDesignInEditor.mockReset();
    toastMock.error.mockReset();
  });

  it('surfaces editor launch failures instead of swallowing them', async () => {
    const user = userEvent.setup();
    designModeMock.listDesignEditors.mockResolvedValue({
      editors: [{ id: 'cursor', label: 'Cursor', available: true }],
    });
    designModeMock.getDesignProjectDir.mockResolvedValue({
      path: '/tmp/design-project',
    });
    designModeMock.openDesignInEditor.mockRejectedValue(
      new Error('Cursor $& is not installed'),
    );

    renderWithProviders(
      <DesignHandoffMenu projectId="project_1">
        <button type="button">Open handoff</button>
      </DesignHandoffMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'Open handoff' }));
    await screen.findByText('Cursor');
    await user.click(screen.getByRole('button', { name: /cursor/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Could not open editor: Cursor $& is not installed',
      ),
    );
  });
});
