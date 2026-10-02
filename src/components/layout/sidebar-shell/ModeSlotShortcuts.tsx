import { useSettingsValue } from '@/shared/db/settings';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import type { ModeDefinition } from '@/shared/modes/types';
import { useMode } from '@/shared/modes/useMode';

function ModeShortcut({ mode }: { mode: ModeDefinition }) {
  const { setActiveMode } = useMode();
  const slot = mode.shortcutSlot ?? 1;
  useShortcut({
    id: `mode.switch.${mode.id}`,
    chord: `mod+${slot}`,
    scope: 'global',
    descriptionKey: mode.labelKey,
    group: 'mode',
    handler: () => setActiveMode(mode.id),
  });
  return null;
}

/** Registers ⌘1…⌘n once for the shell, independent of ModeSwitcher. */
export function ModeSlotShortcuts() {
  const { modes } = useMode();
  const simpleShell = useSettingsValue().ui.simpleShell;
  return modes
    .filter((mode) => mode.shortcutSlot)
    .filter((mode) => !(simpleShell && mode.id === 'chat'))
    .map((mode) => <ModeShortcut key={mode.id} mode={mode} />);
}
