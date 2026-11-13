import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ModelOption } from '@/components/shared/ChatInput.types';
import { ModelSearchMenu } from '@/components/shared/ModelSearchMenu';

/**
 * Two catalog rows that share a long prefix. CSS truncation makes them look
 * identical; the option title is what still names the exact model.
 */
const SAME_PREFIX_MODELS: ModelOption[] = [
  model('openrouter/google/gemini-2.5-pro-preview-06-05'),
  model('openrouter/google/gemini-2.5-pro-preview-05-06'),
];

describe('ModelSearchMenu truncated option titles', () => {
  it('discloses the complete name of a truncated option without changing the selected model', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const selected = SAME_PREFIX_MODELS[0]!;
    const other = SAME_PREFIX_MODELS[1]!;

    render(
      <ModelSearchMenu
        options={SAME_PREFIX_MODELS}
        activeModelId={selected.id}
        onSelect={onSelect}
        groupLabels={{
          claude: 'Claude',
          codex: 'Codex',
          other: 'Other providers',
        }}
        searchPlaceholder="Search models"
        emptyLabel="No models"
      />,
    );

    const list = screen.getByRole('listbox');
    const group = within(list).getByRole('group', {
      name: 'Other providers',
    });
    const options = within(group).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual(
      SAME_PREFIX_MODELS.map((entry) => expect.stringContaining(entry.label)),
    );

    for (const entry of SAME_PREFIX_MODELS) {
      const option = within(list).getByRole('option', {
        name: `${entry.label} OpenRouter`,
      });
      expect(within(option).getByText(entry.label)).toHaveClass('truncate');
      expect(within(option).getByText('OpenRouter')).toBeInTheDocument();
      expect(option).toHaveAttribute('title', entry.label);
    }

    expect(selectionMark(options[0]!)).toHaveClass('opacity-100');
    expect(selectionMark(options[1]!)).toHaveClass('opacity-0');
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(
      within(list).getByRole('option', { name: `${other.label} OpenRouter` }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(other.id);
    expect(selectionMark(options[0]!)).toHaveClass('opacity-100');
    expect(selectionMark(options[1]!)).toHaveClass('opacity-0');
  });
});

function model(id: string): ModelOption {
  return {
    id,
    label: id,
    description: 'OpenRouter',
    provider: 'openai-compat',
  };
}

function selectionMark(option: HTMLElement): Element {
  const mark = option.querySelector('svg');
  expect(mark).not.toBeNull();
  return mark!;
}
