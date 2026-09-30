import { Outlet } from 'react-router-dom';

import { AutomationNotification } from '@/components/automation/AutomationNotification';
import { PetOverlayRoot } from '@/components/pets/PetOverlayRoot';
import { SearchCommandDialog } from '@/components/search';
import { UpdateNotification } from '@/components/settings/components/UpdateNotification';
import { SettingsHost } from '@/components/settings/SettingsHost';
import { BuiltinShortcuts } from '@/components/shortcuts/BuiltinShortcuts';
import { ShortcutOverlay } from '@/components/shortcuts/ShortcutOverlay';
import { HotkeyProvider } from '@/shared/hotkeys/HotkeyProvider';
import { ModeProvider } from '@/shared/modes/ModeProvider';
import '@/shared/modes/modes.builtin';

import { RouteViewTransition } from './RouteViewTransition';

export function AppRouteProviders() {
  return (
    <ModeProvider>
      <HotkeyProvider>
        <BuiltinShortcuts />
        <RouteViewTransition>
          <Outlet />
        </RouteViewTransition>
        <SearchCommandDialog />
        <ShortcutOverlay />
        <AutomationNotification />
        <UpdateNotification />
        <PetOverlayRoot />
        <SettingsHost />
      </HotkeyProvider>
    </ModeProvider>
  );
}
