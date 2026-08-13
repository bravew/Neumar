import type { RefObject } from 'react';

import { screen } from '@testing-library/react';
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

function modelFixture(label: string): ModelOption {
  return {
    id: 'long-model',
    label,
    description: 'Long model',
    provider: 'openai-compat',
  };
}
