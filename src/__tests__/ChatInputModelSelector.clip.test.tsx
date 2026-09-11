import type { RefObject } from 'react';

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ModelOption } from '@/components/shared/ChatInput.types';
import { ModelSelector } from '@/components/shared/ChatInputModelSelector';

import { renderWithProviders } from './helpers/render-with-providers';

describe('ChatInput model selector label clipping', () => {
  it('clips long active model labels and exposes the full title', () => {
    const activeModelLabel =
      'custom-provider/super-long-model-name-that-should-not-overflow-the-composer';

    renderWithProviders(
      <ModelSelector
        modelOptions={[modelFixture(activeModelLabel)]}
        activeModelId="long-model"
        activeModelLabel={activeModelLabel}
        onModelChange={vi.fn()}
        isRunning={false}
        disabled={false}
        isHome={false}
        triggerRef={{ current: null } as RefObject<HTMLButtonElement | null>}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: `Selected model: ${activeModelLabel}`,
    });
    expect(trigger).toHaveClass('min-w-0');

    const label = screen.getByText(activeModelLabel);
    expect(label).toHaveClass('truncate');
    expect(label).toHaveClass('max-w-40');
    expect(label).toHaveAttribute('title', activeModelLabel);
  });
});

describe('ChatInput model selector search', () => {
  it('searches across model and provider names', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ModelSelector
        modelOptions={searchModels}
        activeModelId="claude-sonnet-5"
        activeModelLabel="Sonnet 5"
        onModelChange={vi.fn()}
        isRunning={false}
        disabled={false}
        isHome
        triggerRef={{ current: null } as RefObject<HTMLButtonElement | null>}
      />,
    );

    await user.click(screen.getByRole('button', { name: /selected model/i }));
    const search = screen.getByRole('combobox', { name: /search models/i });
    expect(search).toHaveFocus();

    await user.type(search, 'OpenRouter');

    await waitFor(() =>
      expect(screen.getByText('openai/gpt-4o-mini')).toBeVisible(),
    );
    expect(
      within(screen.getByRole('listbox')).queryByText('Sonnet 5'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeVisible();
  });

  it('selects the filtered model from the keyboard', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();

    renderWithProviders(
      <ModelSelector
        modelOptions={searchModels}
        activeModelId="claude-sonnet-5"
        activeModelLabel="Sonnet 5"
        onModelChange={onModelChange}
        isRunning={false}
        disabled={false}
        isHome
        triggerRef={{ current: null } as RefObject<HTMLButtonElement | null>}
      />,
    );

    await user.click(screen.getByRole('button', { name: /selected model/i }));
    await user.type(
      screen.getByRole('combobox', { name: /search models/i }),
      'deepseek-v4-pro',
    );
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onModelChange).toHaveBeenCalledWith('deepseek-v4-pro');
    expect(
      screen.queryByRole('combobox', { name: /search models/i }),
    ).not.toBeInTheDocument();
  });

  it('excludes rows that only fuzzy-match the query', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ModelSelector
        modelOptions={noisySearchModels}
        activeModelId="claude-sonnet-5"
        activeModelLabel="Sonnet 5"
        onModelChange={vi.fn()}
        isRunning={false}
        disabled={false}
        isHome
        triggerRef={{ current: null } as RefObject<HTMLButtonElement | null>}
      />,
    );

    await user.click(screen.getByRole('button', { name: /selected model/i }));
    await user.type(
      screen.getByRole('combobox', { name: /search models/i }),
      'deepseek',
    );

    await waitFor(() =>
      expect(screen.getByText('deepseek-v4-pro')).toBeVisible(),
    );
    // Subsequence matches used to be ranked above real hits.
    expect(
      screen.queryByText('Claude Opus 5 1M Medium Thinking'),
    ).not.toBeInTheDocument();
  });

  it('matches every whitespace-separated term', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ModelSelector
        modelOptions={noisySearchModels}
        activeModelId="claude-sonnet-5"
        activeModelLabel="Sonnet 5"
        onModelChange={vi.fn()}
        isRunning={false}
        disabled={false}
        isHome
        triggerRef={{ current: null } as RefObject<HTMLButtonElement | null>}
      />,
    );

    await user.click(screen.getByRole('button', { name: /selected model/i }));
    await user.type(
      screen.getByRole('combobox', { name: /search models/i }),
      'deepseek vision',
    );

    await waitFor(() =>
      expect(screen.getByText('deepseek-v4-flash-vision-exp')).toBeVisible(),
    );
    expect(screen.queryByText('deepseek-v4-pro')).not.toBeInTheDocument();
  });

  it('shows an empty state and clears the query after closing', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ModelSelector
        modelOptions={searchModels}
        activeModelId="claude-sonnet-5"
        activeModelLabel="Sonnet 5"
        onModelChange={vi.fn()}
        isRunning={false}
        disabled={false}
        isHome
        triggerRef={{ current: null } as RefObject<HTMLButtonElement | null>}
      />,
    );

    const trigger = screen.getByRole('button', { name: /selected model/i });
    await user.click(trigger);
    await user.type(
      screen.getByRole('combobox', { name: /search models/i }),
      'no-such-model',
    );
    expect(screen.getByText('No models found')).toBeVisible();

    await user.keyboard('{Escape}');
    await user.click(trigger);

    expect(
      screen.getByRole('combobox', { name: /search models/i }),
    ).toHaveValue('');
    expect(
      within(screen.getByRole('listbox')).getByText('Sonnet 5'),
    ).toBeVisible();
  });
});

function modelFixture(label: string): ModelOption {
  return {
    id: 'long-model',
    label,
    description: 'Long model',
    provider: 'openai-compat',
  };
}

const searchModels: ModelOption[] = [
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    description: 'Anthropic Claude',
    provider: 'claude',
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'openai/gpt-4o-mini',
    description: 'OpenRouter',
    provider: 'openai-compat',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'deepseek-v4-pro',
    description: 'DeepSeek',
    provider: 'openai-compat',
  },
];

const noisySearchModels: ModelOption[] = [
  ...searchModels,
  {
    id: 'deepseek-v4-flash-vision-exp',
    label: 'deepseek-v4-flash-vision-exp',
    description: 'DeepSeek',
    provider: 'openai-compat',
  },
  {
    // Every character of "deepseek" appears, in order, across this label.
    id: 'opus-5-1m-medium-thinking',
    label: 'Claude Opus 5 1M Medium Thinking',
    description: 'Cursor Agent',
    provider: 'openai-compat',
  },
];
