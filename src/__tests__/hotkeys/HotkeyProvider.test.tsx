import { MemoryRouter } from 'react-router-dom';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HotkeyProvider } from '@/shared/hotkeys/HotkeyProvider';
import { HotkeyRegistry } from '@/shared/hotkeys/HotkeyRegistry';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import { ModeProvider } from '@/shared/modes/ModeProvider';
import { ModeRegistry } from '@/shared/modes/ModeRegistry';
import type { ModeDefinition } from '@/shared/modes/types';

const Icon = () => null;

function mode(overrides: Partial<ModeDefinition>): ModeDefinition {
  return {
    id: 'tasks',
    labelKey: 'modes.tasks.label',
    icon: Icon,
    rootPath: '/',
    matches: ['/'],
    enabled: true,
    order: 1,
    sidebar: {
      primaryAction: {
        labelKey: 'modes.tasks.primaryAction',
        onSelect: () => {},
      },
      sections: [],
    },
    ...overrides,
  };
}

function ShortcutProbe({ onSearch }: { onSearch: () => void }) {
  useShortcut({
    id: 'search',
    chord: 'mod+k',
    scope: 'global',
    descriptionKey: 'shortcuts.paletteSearch.description',
    group: 'navigation',
    handler: onSearch,
  });

  return <input aria-label="Name" />;
}

function ComposerProbe({ onSearch }: { onSearch: () => void }) {
  useShortcut({
    id: 'composer.search',
    chord: 'mod+k',
    scope: 'composer',
    descriptionKey: 'shortcuts.composer.description',
    group: 'composer',
    ignoreInEditable: false,
    handler: onSearch,
  });

  return <textarea aria-label="Prompt" />;
}

function renderHotkeys(ui: React.ReactNode) {
  ModeRegistry.register(mode({ id: 'tasks' }));
  return render(
    <MemoryRouter>
      <ModeProvider>
        <HotkeyProvider>{ui}</HotkeyProvider>
      </ModeProvider>
    </MemoryRouter>,
  );
}

describe('HotkeyProvider', () => {
  afterEach(() => {
    HotkeyRegistry.clear();
    ModeRegistry.clear();
  });

  it('fires a registered global shortcut once', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderHotkeys(<ShortcutProbe onSearch={onSearch} />);

    await user.keyboard('{Control>}k{/Control}');

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('suppresses global shortcuts in editable elements by default', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderHotkeys(<ShortcutProbe onSearch={onSearch} />);

    screen.getByRole('textbox', { name: 'Name' }).focus();
    await user.keyboard('{Control>}k{/Control}');

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('allows composer shortcuts in editable elements', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderHotkeys(<ComposerProbe onSearch={onSearch} />);

    screen.getByRole('textbox', { name: 'Prompt' }).focus();
    await user.keyboard('{Control>}k{/Control}');

    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
