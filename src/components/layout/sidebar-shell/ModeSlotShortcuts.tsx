import { useNavigate } from 'react-router-dom';

import { useShortcut } from '@/shared/hotkeys/useShortcut';
import type { ModeDefinition } from '@/shared/modes/types';
import { useMode } from '@/shared/modes/useMode';

function ModeShortcut({ mode }: { mode: ModeDefinition }) {
  const navigate = useNavigate();
  const slot = mode.shortcutSlot ?? 1;
  useShortcut({
    id: `mode.switch.${mode.id}`,
    chord: `mod+${slot}`,
    scope: 'global',
    descriptionKey: mode.labelKey,
    group: 'mode',
    handler: () => navigate(mode.rootPath),
  });
  return null;
}

/** Registers ⌘1…⌘n once for the shell, independent of ModeSwitcher. */
export function ModeSlotShortcuts() {
  const { modes } = useMode();
  return modes
    .filter((mode) => mode.shortcutSlot)
    .map((mode) => <ModeShortcut key={mode.id} mode={mode} />);
}
