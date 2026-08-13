import { describe, expect, it } from 'vitest';

import {
  matchesChord,
  normalizeChord,
  parseChord,
} from '@/shared/hotkeys/chord';

function keyEvent(
  key: string,
  init: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...init });
}

describe('hotkey chord parsing', () => {
  it('normalizes aliases and modifier order', () => {
    expect(normalizeChord('Cmd+Shift+P')).toBe('mod+shift+p');
    expect(normalizeChord('option+command+/')).toBe('mod+alt+/');
    expect(parseChord('ctrl+alt+escape')).toEqual({
      mod: false,
      ctrl: true,
      alt: true,
      shift: false,
      key: 'esc',
    });
  });

  it('matches mod against command on macOS', () => {
    expect(
      matchesChord(keyEvent('k', { metaKey: true }), 'mod+k', 'MacIntel'),
    ).toBe(true);
    expect(
      matchesChord(keyEvent('k', { ctrlKey: true }), 'mod+k', 'MacIntel'),
    ).toBe(false);
  });

  it('matches mod against ctrl on non-macOS', () => {
    expect(
      matchesChord(keyEvent('k', { ctrlKey: true }), 'mod+k', 'Win32'),
    ).toBe(true);
    expect(
      matchesChord(keyEvent('k', { metaKey: true }), 'mod+k', 'Win32'),
    ).toBe(false);
    expect(
      matchesChord(
        keyEvent('k', { ctrlKey: true, metaKey: true }),
        'mod+k',
        'Win32',
      ),
    ).toBe(false);
  });

  it('matches explicit ctrl chords on non-macOS', () => {
    expect(
      matchesChord(keyEvent('k', { ctrlKey: true }), 'ctrl+k', 'Win32'),
    ).toBe(true);
  });

  it('respects shift and slash keys', () => {
    expect(
      matchesChord(
        keyEvent('/', { metaKey: true, shiftKey: true }),
        'mod+shift+/',
        'MacIntel',
      ),
    ).toBe(true);
  });
});
