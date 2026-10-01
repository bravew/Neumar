import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SimpleShellOptIn } from '@/components/settings/tabs/SimpleShellOptIn';
import { defaultSettings } from '@/shared/db/settings';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('Simple shell opt-in', () => {
  it('writes simpleShell from General advanced and shows the local open count', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithProviders(
      <SimpleShellOptIn
        settings={{
          ...defaultSettings,
          ui: { ...defaultSettings.ui, usageActivityOpens: 3 },
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(screen.getByTestId('usage-activity-opens')).toHaveTextContent(
      'Dashboard has been opened 3 times on this device.',
    );
    await user.click(screen.getByRole('switch', { name: 'Simple shell' }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ui: expect.objectContaining({
          simpleShell: true,
          usageActivityOpens: 3,
        }),
      }),
    );
  });
});
