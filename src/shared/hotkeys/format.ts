import type { KeyChord } from './types';

export function getNavigatorPlatform(): string {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return nav.userAgentData?.platform ?? nav.userAgent;
}

export function isMacPlatform(platform = getNavigatorPlatform()): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function formatChord(
  chord: KeyChord,
  platform = getNavigatorPlatform(),
): string {
  const isMac = isMacPlatform(platform);
  return chord
    .split('+')
    .map((part) => {
      const token = part.toLowerCase();
      if (token === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (token === 'shift') return isMac ? '⇧' : 'Shift';
      if (token === 'alt') return isMac ? '⌥' : 'Alt';
      if (token === 'ctrl') return isMac ? '⌃' : 'Ctrl';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join('+');
}
