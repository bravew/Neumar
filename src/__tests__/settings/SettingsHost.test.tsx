import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { openSettings } from '@/components/settings/openSettings';
import { SettingsHost } from '@/components/settings/SettingsHost';

vi.mock('@/components/settings/SettingsModal', () => ({
  SettingsModal: ({
    open,
    initialCategory,
  }: {
    open: boolean;
    initialCategory?: string;
  }) =>
    open ? (
      <div data-testid="settings-host-modal">
        {initialCategory ?? 'account'}
      </div>
    ) : null,
}));

describe('SettingsHost', () => {
  it('opens on the category carried in the event detail', () => {
    render(<SettingsHost />);
    act(() => {
      openSettings('keyboard');
    });
    expect(screen.getByTestId('settings-host-modal')).toHaveTextContent(
      'keyboard',
    );
  });

  it('opens the default category when the event has no category', () => {
    render(<SettingsHost />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-settings'));
    });
    expect(screen.getByTestId('settings-host-modal')).toHaveTextContent(
      'account',
    );
  });
});
