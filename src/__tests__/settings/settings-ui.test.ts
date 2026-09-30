import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SLUG } from '@/config/branding';
import { getSettings } from '@/shared/db/settings';

function installStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  });
}

describe('Settings.ui merge', () => {
  beforeEach(() => {
    installStorage();
  });

  it('fills every ui default when stored ui is partial', () => {
    localStorage.setItem(`${APP_SLUG}_settings`, JSON.stringify({ ui: {} }));
    expect(getSettings().ui.simpleShell).toBe(false);
  });
});
