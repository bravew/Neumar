import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SLUG } from '@/config/branding';
import { getSettings } from '@/shared/db/settings';

describe('Settings.ui explicit value', () => {
  beforeEach(() => {
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
  });

  it('keeps simpleShell when stored settings set it', () => {
    localStorage.setItem(
      `${APP_SLUG}_settings`,
      JSON.stringify({ ui: { simpleShell: true } }),
    );
    expect(getSettings().ui.simpleShell).toBe(true);
  });
});
