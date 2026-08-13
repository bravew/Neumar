import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  getDisabledPluginNames,
  getInstalledPlugin,
  listInstalledPlugins,
  reconcileBundledPlugins,
  setPluginEnabled,
  type BundledPluginSeed,
} from '@/shared/db/plugins';

afterEach(() => {
  closeDatabase();
});

const seed = (name: string): BundledPluginSeed => ({
  id: `bundled/${name}`,
  name,
  version: '1.0.0',
  installPath: `/repo/plugins/builtin/${name}`,
  manifest: { name, version: '1.0.0', description: `${name} plugin` },
});

describe('reconcileBundledPlugins', () => {
  it('inserts new builtins enabled and is idempotent', () => {
    const inserted = reconcileBundledPlugins([
      seed('event-recap'),
      seed('explainer'),
    ]);
    expect(inserted).toBe(2);

    const row = getInstalledPlugin('bundled/event-recap');
    expect(row?.scope).toBe('bundled');
    expect(row?.enabled).toBe(true);

    // Second reconcile inserts nothing new.
    expect(
      reconcileBundledPlugins([seed('event-recap'), seed('explainer')]),
    ).toBe(0);
  });

  it('preserves a user disable across reconciles', () => {
    reconcileBundledPlugins([seed('social-reel')]);
    expect(setPluginEnabled('bundled/social-reel', false)).toBe(true);

    // Re-reconcile (e.g. next boot) — updates metadata but keeps disabled.
    reconcileBundledPlugins([seed('social-reel')]);
    expect(getInstalledPlugin('bundled/social-reel')?.enabled).toBe(false);
    expect(getDisabledPluginNames().has('social-reel')).toBe(true);
  });

  it('lists builtins under the bundled scope', () => {
    reconcileBundledPlugins([seed('talking-head-auto-cut')]);
    const bundled = listInstalledPlugins({ scope: 'bundled' });
    expect(bundled.some((p) => p.name === 'talking-head-auto-cut')).toBe(true);
  });
});
