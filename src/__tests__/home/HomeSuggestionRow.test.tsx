import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HomeSuggestionRow } from '@/components/home/HomeSuggestionRow';
import type { ChipDefinition } from '@/shared/modes/types';

const Icon = () => null;

const chipLabels: Record<string, string> = {
  'composer.starter.tasks.code': 'Code',
  'composer.starter.tasks.write': 'Write',
  'composer.starter.tasks.plan': 'Plan',
};

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    tt: (key: string) => chipLabels[key] ?? key,
    t: {
      home: {
        quickActions: { moreIdeas: 'More ideas', back: 'Back' },
        quickActionCategories: {
          write: { label: 'Write', items: {} },
          code: { label: 'Code', items: {} },
          analyze: { label: 'Analyze', items: {} },
          create: { label: 'Create', items: {} },
          plan: { label: 'Plan', items: {} },
        },
      },
    },
  }),
}));

const chips: ChipDefinition[] = [
  {
    id: 'tasks.code',
    labelKey: 'composer.starter.tasks.code',
    icon: Icon,
    action: { kind: 'prefill', prompt: 'code' },
  },
  {
    id: 'tasks.write',
    labelKey: 'composer.starter.tasks.write',
    icon: Icon,
    action: { kind: 'prefill', prompt: 'write' },
  },
  {
    id: 'tasks.plan',
    labelKey: 'composer.starter.tasks.plan',
    icon: Icon,
    action: { kind: 'prefill', prompt: 'plan' },
  },
];

describe('HomeSuggestionRow', () => {
  it('renders one row whose visible labels are unique', () => {
    render(
      <HomeSuggestionRow
        chips={chips}
        onSelectChip={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );

    const row = screen.getByTestId('home-suggestion-row');
    const labels = within(row)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(['Code', 'Write', 'Plan', 'More ideas']);
    expect(new Set(labels).size).toBe(labels.length);
    expect(screen.queryByRole('menuitem', { name: 'Analyze' })).toBeNull();
  });
});
