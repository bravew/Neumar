import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRecipePicker } from '@/components/video/AgentRecipePicker';

describe('AgentRecipePicker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads recipes and sends the recipe prompt on selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            recipes: [
              {
                id: 'product-reel',
                name: 'Product reel',
                version: 1,
                systemPrompt: '',
                toolSequence: [],
                defaults: {},
                outputPreset: '16:9',
                inputSchema: {},
                isBuiltin: true,
                createdAt: '2026-05-20T00:00:00.000Z',
                updatedAt: '2026-05-20T00:00:00.000Z',
              },
            ],
          }),
        ),
      ),
    );

    render(
      <AgentRecipePicker
        labels={labels}
        disabled={false}
        onSelect={onSelect}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: /Product reel/ }),
    );

    expect(onSelect).toHaveBeenCalledWith(
      'Use the Product reel recipe for this project.\n\nrecipeId: product-reel',
    );
  });
});

const labels = {
  title: 'Recipes',
  loading: 'Loading recipes...',
  empty: 'No recipes yet.',
  prompt: 'Use the {recipe} recipe for this project.',
};
