import { useEffect, useMemo, useState } from 'react';

import { Volume2 } from 'lucide-react';

import type { Settings } from '@/shared/db/settings';
import {
  applyNotificationPreferences,
  FAILURE_SOUNDS,
  getNotificationPermissionState,
  getNotificationPreferences,
  previewFailure,
  previewSuccess,
  sendTestNotification,
  SUCCESS_SOUNDS,
  type FailureSoundId,
  type NotificationPermissionState,
  type NotificationPreferences,
  type SuccessSoundId,
} from '@/shared/lib/notifications';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface NotificationSettingsSectionProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

function Switch({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
        checked ? 'bg-primary focus:ring-primary' : 'bg-input focus:ring-ring',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

function permissionLabel(
  permission: NotificationPermissionState,
  messages: Record<string, string>,
): string {
  switch (permission) {
    case 'granted':
      return messages.notifyPermissionGranted;
    case 'denied':
      return messages.notifyPermissionDenied;
    case 'default':
      return messages.notifyPermissionDefault;
    case 'unsupported':
      return messages.notifyPermissionUnsupported;
  }
}

export function NotificationSettingsSection({
  settings,
  onSettingsChange,
}: NotificationSettingsSectionProps) {
  const { t } = useLanguage();
  const messages = t.settings as typeof t.settings & Record<string, string>;
  const prefs = useMemo(() => getNotificationPreferences(settings), [settings]);
  const [permission, setPermission] =
    useState<NotificationPermissionState>('default');

  useEffect(() => {
    let cancelled = false;
    getNotificationPermissionState()
      .then((state) => {
        if (!cancelled) setPermission(state);
      })
      .catch(() => {
        if (!cancelled) setPermission('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buildSettings = (
    partial: Partial<NotificationPreferences>,
    base: Settings = settings,
  ): Settings => applyNotificationPreferences(base, partial);

  const updatePreferences = (partial: Partial<NotificationPreferences>) => {
    onSettingsChange(buildSettings(partial));
  };

  const handleDesktopToggle = async () => {
    const next = !prefs.desktopEnabled;
    const nextSettings = buildSettings({ desktopEnabled: next });
    onSettingsChange(nextSettings);

    if (!next) return;

    const sent = await sendTestNotification(
      messages.notifyTestTitle,
      messages.notifyTestBody,
    );
    const state = await getNotificationPermissionState();
    setPermission(state);

    if (!sent) {
      onSettingsChange(buildSettings({ desktopEnabled: false }, nextSettings));
    }
  };

  const handleSoundToggle = () => {
    const next = !prefs.soundEnabled;
    updatePreferences({ soundEnabled: next });
    if (next) previewSuccess(prefs.successSoundId);
  };

  const selectSuccessSound = (id: SuccessSoundId) => {
    updatePreferences({ successSoundId: id });
    previewSuccess(id);
  };

  const selectFailureSound = (id: FailureSoundId) => {
    updatePreferences({ failureSoundId: id });
    previewFailure(id);
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {messages.notifications}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {messages.notifySectionDescription}
          </p>
        </div>
        <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]">
          {permissionLabel(permission, messages)}
        </span>
      </div>

      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground text-sm font-medium">
              {messages.notifyOnCompletion}
            </span>
            <p className="text-muted-foreground text-xs">
              {messages.notifyOnCompletionDescription}
            </p>
          </div>
          <Switch
            checked={prefs.desktopEnabled}
            label={messages.notifyOnCompletion}
            onClick={() => {
              void handleDesktopToggle();
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground flex items-center gap-2 text-sm font-medium">
              <Volume2 className="size-4" />
              {messages.notifySounds}
            </span>
            <p className="text-muted-foreground text-xs">
              {messages.notifySoundsDescription}
            </p>
          </div>
          <Switch
            checked={prefs.soundEnabled}
            label={messages.notifySounds}
            onClick={handleSoundToggle}
          />
        </div>

        {prefs.soundEnabled && (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-foreground text-xs font-medium">
                {messages.notifySuccessSound}
              </span>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {SUCCESS_SOUNDS.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    aria-pressed={prefs.successSoundId === sound.id}
                    onClick={() => selectSuccessSound(sound.id)}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                      prefs.successSoundId === sound.id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                  >
                    {messages[sound.labelKey]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-foreground text-xs font-medium">
                {messages.notifyFailureSound}
              </span>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {FAILURE_SOUNDS.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    aria-pressed={prefs.failureSoundId === sound.id}
                    onClick={() => selectFailureSound(sound.id)}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                      prefs.failureSoundId === sound.id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                  >
                    {messages[sound.labelKey]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground text-sm font-medium">
              {messages.notifyWhileFocused}
            </span>
            <p className="text-muted-foreground text-xs">
              {messages.notifyWhileFocusedDescription}
            </p>
          </div>
          <Switch
            checked={prefs.notifyWhileFocused}
            label={messages.notifyWhileFocused}
            onClick={() =>
              updatePreferences({
                notifyWhileFocused: !prefs.notifyWhileFocused,
              })
            }
          />
        </div>

        {permission === 'denied' && (
          <p className="text-muted-foreground text-xs">
            {messages.notifyPermissionDeniedHint}
          </p>
        )}
      </div>
    </section>
  );
}
