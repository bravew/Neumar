import {
  getSettings,
  saveSettings,
  subscribeToSettings,
  type Settings,
} from '@/shared/db/settings';

import {
  DEFAULT_FAILURE_SOUND_ID,
  DEFAULT_SUCCESS_SOUND_ID,
  type FailureSoundId,
  isFailureSoundId,
  isSuccessSoundId,
  type SuccessSoundId,
} from './sound';

export interface NotificationPreferences {
  desktopEnabled: boolean;
  soundEnabled: boolean;
  successSoundId: SuccessSoundId;
  failureSoundId: FailureSoundId;
  notifyWhileFocused: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  desktopEnabled: true,
  soundEnabled: false,
  successSoundId: DEFAULT_SUCCESS_SOUND_ID,
  failureSoundId: DEFAULT_FAILURE_SOUND_ID,
  notifyWhileFocused: false,
};

function normalizeSuccessSoundId(value: unknown): SuccessSoundId {
  return typeof value === 'string' && isSuccessSoundId(value)
    ? value
    : DEFAULT_SUCCESS_SOUND_ID;
}

function normalizeFailureSoundId(value: unknown): FailureSoundId {
  return typeof value === 'string' && isFailureSoundId(value)
    ? value
    : DEFAULT_FAILURE_SOUND_ID;
}

export function getNotificationPreferences(
  settings: Settings = getSettings(),
): NotificationPreferences {
  return {
    desktopEnabled: settings.notifyOnCompletion ?? true,
    soundEnabled: settings.notifySoundEnabled ?? false,
    successSoundId: normalizeSuccessSoundId(settings.notifySuccessSoundId),
    failureSoundId: normalizeFailureSoundId(settings.notifyFailureSoundId),
    notifyWhileFocused: settings.notifyWhileFocused ?? false,
  };
}

export function applyNotificationPreferences(
  base: Settings,
  partial: Partial<NotificationPreferences>,
): Settings {
  return {
    ...base,
    ...(partial.desktopEnabled === undefined
      ? {}
      : { notifyOnCompletion: partial.desktopEnabled }),
    ...(partial.soundEnabled === undefined
      ? {}
      : { notifySoundEnabled: partial.soundEnabled }),
    ...(partial.successSoundId === undefined
      ? {}
      : { notifySuccessSoundId: partial.successSoundId }),
    ...(partial.failureSoundId === undefined
      ? {}
      : { notifyFailureSoundId: partial.failureSoundId }),
    ...(partial.notifyWhileFocused === undefined
      ? {}
      : { notifyWhileFocused: partial.notifyWhileFocused }),
  };
}

export function setNotificationPreferences(
  partial: Partial<NotificationPreferences>,
): void {
  saveSettings(applyNotificationPreferences(getSettings(), partial));
}

export function subscribeNotificationPreferences(
  listener: (prefs: NotificationPreferences) => void,
): () => void {
  return subscribeToSettings(() => listener(getNotificationPreferences()));
}
