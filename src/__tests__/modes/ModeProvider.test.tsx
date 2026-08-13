import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ModeProvider } from '@/shared/modes/ModeProvider';
import { ModeRegistry } from '@/shared/modes/ModeRegistry';
import type { ModeDefinition } from '@/shared/modes/types';
import { useMode } from '@/shared/modes/useMode';

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

function Probe() {
  const { activeMode, modes, setActiveMode } = useMode();
  return (
    <div>
      <div data-testid="mode">{activeMode.id}</div>
      <div data-testid="modes">{modes.map((mode) => mode.id).join(',')}</div>
      <button onClick={() => setActiveMode('design')}>Design</button>
    </div>
  );
}

describe('ModeProvider', () => {
  afterEach(() => {
    ModeRegistry.clear();
  });

  it('derives the active mode from the current URL', () => {
    ModeRegistry.register(mode({ id: 'tasks' }));
    ModeRegistry.register(
      mode({ id: 'design', rootPath: '/design', matches: ['/design'] }),
    );

    render(
      <MemoryRouter initialEntries={['/design']}>
        <ModeProvider>
          <Probe />
        </ModeProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('mode')).toHaveTextContent('design');
  });

  it('navigates to the selected mode root path', async () => {
    const user = userEvent.setup();
    ModeRegistry.register(mode({ id: 'tasks' }));
    ModeRegistry.register(
      mode({ id: 'design', rootPath: '/design', matches: ['/design'] }),
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <ModeProvider>
          <Routes>
            <Route path="/" element={<Probe />} />
            <Route path="/design" element={<Probe />} />
          </Routes>
        </ModeProvider>
      </MemoryRouter>,
    );

    await act(() => user.click(screen.getByRole('button', { name: 'Design' })));

    expect(screen.getByTestId('mode')).toHaveTextContent('design');
  });

  it('applies default extensibility settings to enabled mode registrations', () => {
    ModeRegistry.register(mode({ id: 'tasks', order: 10 }));
    ModeRegistry.register(
      mode({
        id: 'design',
        rootPath: '/design',
        matches: ['/design'],
        order: 20,
      }),
    );
    ModeRegistry.register(
      mode({
        id: 'automate',
        rootPath: '/automation',
        matches: ['/automation'],
        order: 30,
      }),
    );
    ModeRegistry.register(
      mode({ id: 'chat', rootPath: '/chat', matches: ['/chat'], order: 40 }),
    );

    render(
      <MemoryRouter initialEntries={['/automation']}>
        <ModeProvider>
          <Probe />
        </ModeProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('mode')).toHaveTextContent('automate');
    expect(screen.getByTestId('modes')).toHaveTextContent(
      'tasks,design,automate',
    );
  });
});
