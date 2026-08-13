import {
  DEFAULT_DESIGN_MODE_SETTINGS,
  getSettings,
  saveSettings,
} from '@/shared/db/settings';

export function persistDesignModeUi(patch: {
  commentRailCollapsed?: Record<string, boolean>;
  viewMode?: Record<string, string>;
}) {
  const settings = getSettings();
  const current = {
    ...DEFAULT_DESIGN_MODE_SETTINGS,
    ...settings.designMode,
    ui: {
      ...DEFAULT_DESIGN_MODE_SETTINGS.ui,
      ...(settings.designMode?.ui ?? {}),
    },
  };
  saveSettings({
    ...settings,
    designMode: {
      ...current,
      ui: {
        commentRailCollapsed: {
          ...current.ui.commentRailCollapsed,
          ...patch.commentRailCollapsed,
        },
        viewMode: {
          ...current.ui.viewMode,
          ...patch.viewMode,
        },
      },
    },
  });
}
