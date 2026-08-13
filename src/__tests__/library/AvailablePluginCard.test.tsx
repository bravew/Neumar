import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AvailablePluginCard } from '@/components/library/AvailablePluginCard';
import type { AvailablePluginEntry } from '@/shared/hooks/useMarketplaceSources';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      plugins: {
        actions: {
          install: 'Install',
          use: 'Use',
          details: 'Details',
          useOptions: 'Use options',
          useHint: 'Seed the example prompt',
          useWithoutPrompt: 'Use without prompt',
          useWithoutPromptHint: 'Attach only',
        },
        sources: { trustOfficial: 'Official', trustRestricted: 'Restricted' },
      },
    },
  }),
}));

const entry: AvailablePluginEntry = {
  sourceId: 'src-a',
  sourceName: 'Source A',
  sourceTrust: 'official',
  sourceUrl: 'https://example.com/marketplace.json',
  entry: {
    name: 'hyperframes',
    description: 'A plugin',
    source: 'github:acme/hyperframes',
  },
};

describe('AvailablePluginCard', () => {
  it('shows Install and calls onInstall when not installed', () => {
    const onInstall = vi.fn();
    const onUse = vi.fn();
    render(
      <AvailablePluginCard
        entry={entry}
        pending={false}
        installed={false}
        onInstall={onInstall}
        onUse={onUse}
        onUseWithoutPrompt={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Install' });
    fireEvent.click(button);
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Use' })).toBeNull();
  });

  it('shows plain Use (no seed) when installed without an example query', () => {
    const onInstall = vi.fn();
    const onUse = vi.fn();
    const onUseWithoutPrompt = vi.fn();
    render(
      <AvailablePluginCard
        entry={entry}
        pending={false}
        installed
        canSeed={false}
        onInstall={onInstall}
        onUse={onUse}
        onUseWithoutPrompt={onUseWithoutPrompt}
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Use' });
    fireEvent.click(button);
    // No example query → the plain button applies without seeding a prompt.
    expect(onUseWithoutPrompt).toHaveBeenCalledTimes(1);
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use options' })).toBeNull();
  });

  it('shows a split Use button when installed with an example query', () => {
    const onUse = vi.fn();
    const onUseWithoutPrompt = vi.fn();
    render(
      <AvailablePluginCard
        entry={entry}
        pending={false}
        installed
        canSeed
        onInstall={vi.fn()}
        onUse={onUse}
        onUseWithoutPrompt={onUseWithoutPrompt}
        onSelect={vi.fn()}
      />,
    );
    // Primary "Use" seeds the example query.
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(onUse).toHaveBeenCalledTimes(1);
    // The split dropdown trigger is present for "Use without prompt".
    expect(
      screen.getByRole('button', { name: 'Use options' }),
    ).toBeInTheDocument();
  });
});
