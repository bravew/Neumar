import { describe, expect, it } from 'vitest';

import { formatChord, isMacPlatform } from '@/shared/hotkeys/format';

describe('hotkey format', () => {
  it('detects mac platforms', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
  });

  it('formats mod for macOS and other platforms', () => {
    expect(formatChord('mod+shift+k', 'MacIntel')).toBe('⌘+⇧+K');
    expect(formatChord('mod+shift+k', 'Win32')).toBe('Ctrl+Shift+K');
  });
});
