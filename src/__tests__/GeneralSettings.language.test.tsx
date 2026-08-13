import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeneralSettings } from '@/components/settings/tabs/GeneralSettings';
import { defaultSettings, saveSettings } from '@/shared/db/settings';

import { renderWithProviders } from './helpers/render-with-providers';

describe('GeneralSettings language tiles', () => {
  beforeEach(() => {
    saveSettings({ ...defaultSettings, language: 'en-US' });
  });

  it('renders languages as radio tiles instead of a dropdown', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GeneralSettings settings={defaultSettings} onSettingsChange={vi.fn()} />,
    );

    expect(screen.queryByRole('combobox', { name: /language/i })).toBeNull();
    const spanish = screen.getByRole('radio', {
      name: /español.*spanish/i,
    });
    expect(spanish).not.toBeChecked();

    await user.click(spanish);

    expect(spanish).toBeChecked();
    expect(document.documentElement.lang).toBe('es-ES');
  });

  it('moves selection with arrow keys inside the tile group', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GeneralSettings settings={defaultSettings} onSettingsChange={vi.fn()} />,
    );

    const english = screen.getByRole('radio', {
      name: /english.*english/i,
    });
    english.focus();
    await user.keyboard('{ArrowRight}');

    expect(
      screen.getByRole('radio', { name: /简体中文.*chinese/i }),
    ).toBeChecked();
  });
});
