import { SettingsModal } from '@/components/settings';
import type { DesignDebugSnapshot } from '@/shared/types/design-mode';

import { DesignDebugDrawer } from './DesignDebugDrawer';
import { ResolvedPromptDrawer } from './ResolvedPromptDrawer';

export function ProjectViewPanels({
  promptDrawer,
  resolved,
  debugOpen,
  debugSnapshot,
  debugLoading,
  debugError,
  settingsOpen,
  onClosePanel,
  onSettingsOpenChange,
}: {
  promptDrawer: boolean;
  resolved: { system: string; user: string };
  debugOpen: boolean;
  debugSnapshot: DesignDebugSnapshot | null;
  debugLoading: boolean;
  debugError: string | null;
  settingsOpen: boolean;
  onClosePanel: () => void;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      {promptDrawer && (
        <ResolvedPromptDrawer
          system={resolved.system}
          user={resolved.user}
          onClose={onClosePanel}
        />
      )}
      {debugOpen && (
        <DesignDebugDrawer
          snapshot={debugSnapshot}
          loading={debugLoading}
          error={debugError}
          onClose={onClosePanel}
        />
      )}
      <SettingsModal
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        initialCategory="designMode"
      />
    </>
  );
}
