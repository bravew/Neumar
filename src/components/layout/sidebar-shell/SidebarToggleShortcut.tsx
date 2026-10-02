import { useSidebar } from '@/components/layout/sidebar-context';
import { getSettings } from '@/shared/db/settings';
import { useShortcut } from '@/shared/hotkeys/useShortcut';

/**
 * ⌘B lives on the always-mounted shell. Registering it inside the sidebar
 * meant the shortcut disappeared with the panel, so the simple shell could
 * never reopen a panel it had hidden.
 */
export function SidebarToggleShortcut({
  onCyclePanel,
}: {
  onCyclePanel: () => void;
}) {
  const { toggleLeft } = useSidebar();
  useShortcut({
    id: 'sidebar.toggle',
    chord: 'mod+b',
    scope: 'global',
    descriptionKey: 'shortcuts.sidebarToggle.description',
    group: 'navigation',
    handler: () => {
      if (getSettings().ui.simpleShell) onCyclePanel();
      else toggleLeft();
    },
  });
  return null;
}
