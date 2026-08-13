import { afterEach, describe, expect, it, vi } from 'vitest';

import { HotkeyRegistry } from '@/shared/hotkeys/HotkeyRegistry';

describe('HotkeyRegistry', () => {
  afterEach(() => {
    HotkeyRegistry.clear();
    vi.unstubAllEnvs();
  });

  it('registers and unregisters shortcuts', () => {
    const unregister = HotkeyRegistry.register({
      id: 'search',
      chord: 'mod+k',
      scope: 'global',
      descriptionKey: 'shortcuts.paletteSearch.description',
      group: 'navigation',
      handler: () => {},
    });

    expect(HotkeyRegistry.list()).toHaveLength(1);
    unregister();
    expect(HotkeyRegistry.list()).toHaveLength(0);
  });

  it('throws on conflicts in strict test mode', () => {
    vi.stubEnv('NEUMA_HOTKEY_STRICT', '1');
    HotkeyRegistry.register({
      id: 'search',
      chord: 'mod+k',
      scope: 'global',
      descriptionKey: 'shortcuts.paletteSearch.description',
      group: 'navigation',
      handler: () => {},
    });

    expect(() =>
      HotkeyRegistry.register({
        id: 'other',
        chord: 'MOD+K',
        scope: 'global',
        descriptionKey: 'shortcuts.other.description',
        group: 'navigation',
        handler: () => {},
      }),
    ).toThrow(/Shortcut conflict/);
  });

  it('allows the same chord in different scopes', () => {
    HotkeyRegistry.register({
      id: 'global',
      chord: 'mod+n',
      scope: 'global',
      descriptionKey: 'shortcuts.global.description',
      group: 'navigation',
      handler: () => {},
    });
    HotkeyRegistry.register({
      id: 'design',
      chord: 'mod+n',
      scope: 'mode:design',
      descriptionKey: 'shortcuts.design.description',
      group: 'mode',
      handler: () => {},
    });

    expect(HotkeyRegistry.list()).toHaveLength(2);
  });
});
