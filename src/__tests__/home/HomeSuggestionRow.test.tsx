import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeSuggestionRow } from '@/components/home/HomeSuggestionRow';
import ideasEn from '@/config/locale/messages/en/ideas';
import type { ChipDefinition } from '@/shared/modes/types';

const Icon = () => null;

const chipLabels: Record<string, string> = {
  'composer.starter.tasks.code': 'Code',
  'composer.starter.tasks.write': 'Write',
  'composer.starter.tasks.plan': 'Plan',
};

const ui = vi.hoisted(() => ({ simpleShell: false }));

vi.mock('@/shared/db/settings', () => ({
  useSettingsValue: () => ({ ui }),
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    tt: (key: string) => chipLabels[key] ?? key,
    t: {
      ideas: ideasEn,
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

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderRow(onSelectPrompt = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <HomeSuggestionRow
                chips={chips}
                onSelectChip={vi.fn()}
                onSelectPrompt={onSelectPrompt}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return onSelectPrompt;
}

describe('HomeSuggestionRow', () => {
  beforeEach(() => {
    ui.simpleShell = false;
  });

  it('renders one row whose visible labels are unique', () => {
    renderRow();

    const row = screen.getByTestId('home-suggestion-row');
    const labels = within(row)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(['Code', 'Write', 'Plan']);
    expect(new Set(labels).size).toBe(labels.length);
    expect(screen.queryByRole('menuitem', { name: 'Analyze' })).toBeNull();
  });

  describe('with the simple shell', () => {
    beforeEach(() => {
      ui.simpleShell = true;
    });

    it('prefills the composer from a prefill idea', () => {
      const onSelectPrompt = renderRow();
      fireEvent.click(
        screen.getByRole('button', { name: ideasEn.promise.draftEmail }),
      );
      expect(onSelectPrompt).toHaveBeenCalledWith(ideasEn.prompt.draftEmail);
    });

    it('opens the scoping card for an idea that needs answers', () => {
      const onSelectPrompt = renderRow();
      fireEvent.click(
        screen.getByRole('button', { name: ideasEn.promise.weeklyReport }),
      );
      expect(onSelectPrompt).not.toHaveBeenCalled();
      expect(screen.getByTestId('location').textContent).toBe(
        '/ideas?scope=weekly-report',
      );
    });
  });
});
