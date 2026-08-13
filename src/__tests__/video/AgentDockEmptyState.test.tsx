import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDockEmptyState } from '@/components/video/AgentDockEmptyState';
import {
  clearCreativeDebugCounters,
  readCreativeDebugCounters,
} from '@/shared/creative-workflow/debug-counters';

import { installLocalStorageMock } from '../helpers/local-storage';

vi.mock('@/shared/hooks/useVideoPlugins', () => ({
  useVideoPlugins: () => ({ plugins: [], loading: false, error: null }),
}));

vi.mock('@/shared/hooks/useVideoRecipes', () => ({
  useVideoRecipes: () => ({
    recipes: [
      {
        id: 'product-reel',
        name: 'Product reel',
        version: 1,
        outputPreset: '16:9',
      },
    ],
    loading: false,
    error: null,
  }),
}));

describe('AgentDockEmptyState', () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => clearCreativeDebugCounters());

  it('counts guided suggestion and recipe selections locally', async () => {
    const user = userEvent.setup();
    const onSelectPrompt = vi.fn();

    render(
      <AgentDockEmptyState
        pluginLabels={{
          title: 'Plugins',
          loading: 'Loading plugins...',
          empty: 'No video plugins yet.',
          use: 'Use plugin',
          reviewRequired: 'Review',
          reviewConfirm: 'Review {plugin}?',
          capabilities: '{count} capabilities',
          applyFailed: 'Plugin failed: {error}',
          applyNetworkError: 'Could not reach the server.',
          retry: 'Retry',
        }}
        recipeLabels={{
          title: 'Recipes',
          loading: 'Loading recipes...',
          empty: 'No recipes yet.',
          prompt: 'Use the {recipe} recipe for this project.',
        }}
        suggestions={['Regenerate scene 1']}
        disabled={false}
        onSelectPlugin={vi.fn()}
        onSelectPrompt={onSelectPrompt}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Regenerate scene 1' }),
    );
    await user.click(screen.getByRole('button', { name: /Product reel/ }));

    expect(onSelectPrompt).toHaveBeenCalledTimes(2);
    expect(
      readCreativeDebugCounters().events['agent.suggestion.selected']?.count,
    ).toBe(2);
  });
});
