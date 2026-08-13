import { afterEach, describe, expect, it } from 'vitest';

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

describe('ModeRegistry', () => {
  afterEach(() => ModeRegistry.clear());

  it('registers, lists, and unregisters modes in order', () => {
    const unregisterTasks = ModeRegistry.register(
      mode({ id: 'tasks', order: 2 }),
    );
    ModeRegistry.register(
      mode({ id: 'design', rootPath: '/design', order: 1 }),
    );

    expect(ModeRegistry.list().map((entry) => entry.id)).toEqual([
      'design',
      'tasks',
    ]);

    unregisterTasks();
    expect(ModeRegistry.byId('tasks')).toBeUndefined();
  });

  it('resolves string and regex path matches', () => {
    ModeRegistry.register(mode({ id: 'tasks', matches: ['/', /^\/task\//] }));
    ModeRegistry.register(
      mode({ id: 'design', rootPath: '/design', matches: ['/design'] }),
    );

    expect(ModeRegistry.byPath('/task/123')?.id).toBe('tasks');
    expect(ModeRegistry.byPath('/design')?.id).toBe('design');
    expect(ModeRegistry.byPath('/missing')).toBeUndefined();
  });

  it('hides disabled modes by default', () => {
    ModeRegistry.register(mode({ id: 'tasks' }));
    ModeRegistry.register(mode({ id: 'design', enabled: false }));

    expect(ModeRegistry.list().map((entry) => entry.id)).toEqual(['tasks']);
    expect(
      ModeRegistry.list({ includeDisabled: true }).map((entry) => entry.id),
    ).toEqual(['tasks', 'design']);
  });
});
