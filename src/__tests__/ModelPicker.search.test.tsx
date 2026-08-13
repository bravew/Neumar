import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ModelPicker } from '@/components/shared/ModelPicker';

import { renderWithProviders } from './helpers/render-with-providers';

vi.mock('@/shared/db/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/db/settings')>();
  const providers = [
    {
      id: 'claude',
      name: 'Claude',
      apiKey: 'sk-claude',
      baseUrl: '',
      enabled: true,
      models: [],
      agentType: 'claude',
    },
    {
      id: 'custom-openai',
      name: 'Custom OpenAI',
      apiKey: 'sk-custom',
      baseUrl: 'https://api.example.com/v1',
      enabled: true,
      models: ['custom-alpha', 'custom-beta'],
      agentType: 'openai-compat',
    },
  ];
  return {
    ...actual,
    getSettings: () => ({ ...actual.defaultSettings, providers }),
    useSettingsValue: () => ({ ...actual.defaultSettings, providers }),
  };
});

describe('ModelPicker search', () => {
  it('filters configured models and selects the matching option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithProviders(
      <ModelPicker
        value={null}
        onChange={onChange}
        showDefault
        defaultLabel="Default"
      />,
    );

    await user.click(screen.getByRole('button', { name: /default/i }));
    await user.type(screen.getByPlaceholderText('Search models...'), 'beta');

    await waitFor(() =>
      expect(screen.getByText('custom-beta')).toBeInTheDocument(),
    );
    expect(screen.queryByText('custom-alpha')).not.toBeInTheDocument();

    await user.click(screen.getByText('custom-beta'));

    expect(onChange).toHaveBeenCalledWith('custom-beta');
  });
});
