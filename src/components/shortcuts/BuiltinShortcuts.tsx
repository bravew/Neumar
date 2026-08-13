import { useShortcut } from '@/shared/hotkeys/useShortcut';

export function BuiltinShortcuts() {
  useShortcut({
    id: 'app.settings',
    chord: 'mod+,',
    scope: 'global',
    descriptionKey: 'shortcuts.appSettings.description',
    group: 'navigation',
    handler: () => window.dispatchEvent(new CustomEvent('open-settings')),
  });

  useShortcut({
    id: 'palette.command',
    chord: 'mod+shift+p',
    scope: 'global',
    descriptionKey: 'shortcuts.commandPalette.description',
    group: 'navigation',
    handler: () => window.dispatchEvent(new CustomEvent('open-search')),
  });

  return null;
}
