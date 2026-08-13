import { getNavigatorPlatform, isMacPlatform } from './format';
import type { KeyChord } from './types';

export interface ParsedChord {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const MOD_ALIASES = new Set(['mod', 'cmd', 'command', 'meta']);
const CTRL_ALIASES = new Set(['ctrl', 'control']);
const ALT_ALIASES = new Set(['alt', 'option', 'opt']);
const SHIFT_ALIASES = new Set(['shift']);

function normalizeKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === ' ') return 'space';
  if (normalized === 'escape') return 'esc';
  if (normalized === 'arrowup') return 'up';
  if (normalized === 'arrowdown') return 'down';
  if (normalized === 'arrowleft') return 'left';
  if (normalized === 'arrowright') return 'right';
  return normalized;
}

export function parseChord(chord: KeyChord): ParsedChord {
  const parsed: ParsedChord = {
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: '',
  };

  for (const rawPart of chord.split('+')) {
    const part = normalizeKey(rawPart);
    if (!part) continue;
    if (MOD_ALIASES.has(part)) parsed.mod = true;
    else if (CTRL_ALIASES.has(part)) parsed.ctrl = true;
    else if (ALT_ALIASES.has(part)) parsed.alt = true;
    else if (SHIFT_ALIASES.has(part)) parsed.shift = true;
    else parsed.key = part;
  }

  return parsed;
}

export function normalizeChord(chord: KeyChord): KeyChord {
  const parsed = parseChord(chord);
  const parts: string[] = [];
  if (parsed.mod) parts.push('mod');
  if (parsed.ctrl) parts.push('ctrl');
  if (parsed.alt) parts.push('alt');
  if (parsed.shift) parts.push('shift');
  if (parsed.key) parts.push(parsed.key);
  return parts.join('+');
}

export function eventKey(event: KeyboardEvent): string {
  return normalizeKey(event.key);
}

export function matchesChord(
  event: KeyboardEvent,
  chord: KeyChord,
  platform = getNavigatorPlatform(),
): boolean {
  const parsed = parseChord(chord);
  const isMac = isMacPlatform(platform);
  const expectedMeta = isMac ? parsed.mod : false;
  const expectedCtrl = isMac ? parsed.ctrl : parsed.mod || parsed.ctrl;

  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    eventKey(event) === parsed.key
  );
}
