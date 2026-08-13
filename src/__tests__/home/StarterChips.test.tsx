import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StarterChips } from '@/components/home/StarterChips';
import type { ChipDefinition } from '@/shared/modes/types';

const Icon = () => null;

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    tt: (key: string) => key,
  }),
}));

describe('StarterChips', () => {
  it('renders localized chip labels and reports the selected chip', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const chips: ChipDefinition[] = [
      {
        id: 'code',
        labelKey: 'composer.starter.tasks.code',
        icon: Icon,
        action: { kind: 'prefill', prompt: 'code' },
      },
    ];

    render(<StarterChips chips={chips} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: /code/i }));

    expect(screen.getByText('composer.starter.tasks.code')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith(chips[0]);
  });
});
