import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { SettingsModal } from '@/components/settings';
import {
  getSettings,
  saveSettings,
  useSettingsValue,
  type PetPosition,
  type PetSettingsConfig,
  type PetWindowPosition,
} from '@/shared/db/settings';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { getPetForSettings } from '@/shared/pets/catalog';
import {
  normalizeCustomPet,
  normalizePetSettings,
} from '@/shared/pets/settings';
import {
  selectRunningTaskIds,
  useThreadStore,
} from '@/shared/stores/thread-store';

import { PetOverlay } from './PetOverlay';
import {
  isTauriRuntime,
  PET_EVENT_OPEN_SETTINGS,
  PET_EVENT_PATCH,
  PET_EVENT_STATE,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_LABEL,
  PET_WINDOW_TRANSPARENT_COLOR,
  PET_WINDOW_URL,
  PET_WINDOW_WIDTH,
  sameWindowPosition,
  type PetWindowPatchPayload,
  type PetWindowStatePayload,
} from './tauriPetWindow';

export function PetOverlayRoot() {
  const settings = useSettingsValue();
  const runningTaskIds = useThreadStore(selectRunningTaskIds);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backgroundRunningIds, setBackgroundRunningIds] = useState<string[]>(
    [],
  );
  const isNative = useMemo(() => isTauriRuntime(), []);
  const ensuringPetWindowRef = useRef(false);
  const windowPositionFromNativeRef = useRef<PetWindowPosition | null>(null);

  useEffect(() => {
    return subscribeToBackgroundTasks((tasks: BackgroundTask[]) => {
      setBackgroundRunningIds(
        tasks.filter((task) => task.isRunning).map((task) => task.taskId),
      );
    });
  }, []);

  const petSettings = useMemo(
    () => normalizePetSettings(settings.pets),
    [settings.pets],
  );
  const pet = useMemo(() => getPetForSettings(petSettings), [petSettings]);
  const isAgentRunning = useMemo(() => {
    const ids = new Set([...runningTaskIds, ...backgroundRunningIds]);
    return ids.size > 0;
  }, [backgroundRunningIds, runningTaskIds]);

  const latestStateRef = useRef({ petSettings, isAgentRunning });
  latestStateRef.current = { petSettings, isAgentRunning };

  const updatePetSettings = useCallback((patch: Partial<PetSettingsConfig>) => {
    const current = getSettings();
    const currentPets = normalizePetSettings(current.pets);
    saveSettings({
      ...current,
      pets: normalizePetSettings({
        ...currentPets,
        ...patch,
        customPet:
          'customPet' in patch
            ? (patch.customPet ?? null)
            : currentPets.customPet,
        position: patch.position ?? currentPets.position,
        windowPosition: patch.windowPosition ?? currentPets.windowPosition,
      }),
    });
  }, []);

  const handlePositionChange = useCallback(
    (position: PetPosition) => updatePetSettings({ position }),
    [updatePetSettings],
  );

  const emitPetWindowState = useCallback(
    async (state: PetWindowStatePayload) => {
      try {
        const { emitTo } = await import('@tauri-apps/api/event');
        await emitTo(PET_WINDOW_LABEL, PET_EVENT_STATE, state);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('[Pets] Failed to sync pet window state:', error);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!isNative) return;

    let cancelled = false;
    let unlistenPatch: (() => void) | undefined;
    let unlistenOpenSettings: (() => void) | undefined;

    async function setupPetWindowEvents() {
      const { listen } = await import('@tauri-apps/api/event');
      if (cancelled) return;

      unlistenPatch = await listen<PetWindowPatchPayload>(
        PET_EVENT_PATCH,
        ({ payload }) => {
          const patch = normalizePetWindowPatch(payload);
          if (!patch) return;

          if (patch.windowPosition) {
            windowPositionFromNativeRef.current = patch.windowPosition;
          }

          updatePetSettings(patch);
        },
      );
      unlistenOpenSettings = await listen(PET_EVENT_OPEN_SETTINGS, () => {
        setSettingsOpen(true);
      });
    }

    setupPetWindowEvents().catch((error) => {
      if (import.meta.env.DEV) {
        console.error('[Pets] Failed to register pet window events:', error);
      }
    });

    return () => {
      cancelled = true;
      unlistenPatch?.();
      unlistenOpenSettings?.();
    };
  }, [isNative, updatePetSettings]);

  useEffect(() => {
    if (!isNative) return;
    if (ensuringPetWindowRef.current) return;

    ensuringPetWindowRef.current = true;
    let cancelled = false;

    async function syncPetWindow() {
      const [{ WebviewWindow }, { LogicalPosition }] = await Promise.all([
        import('@tauri-apps/api/webviewWindow'),
        import('@tauri-apps/api/window'),
      ]);
      const existingWindow = await WebviewWindow.getByLabel(PET_WINDOW_LABEL);

      if (!petSettings.enabled) {
        await existingWindow?.close().catch((error) => {
          if (import.meta.env.DEV) {
            console.error('[Pets] Failed to close pet window:', error);
          }
        });
        windowPositionFromNativeRef.current = null;
        return;
      }

      if (cancelled) return;

      if (!existingWindow) {
        const petWindow = new WebviewWindow(PET_WINDOW_LABEL, {
          url: PET_WINDOW_URL,
          title: '',
          width: PET_WINDOW_WIDTH,
          height: PET_WINDOW_HEIGHT,
          x: petSettings.windowPosition.x,
          y: petSettings.windowPosition.y,
          transparent: true,
          decorations: false,
          shadow: false,
          resizable: false,
          maximizable: false,
          minimizable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          focus: false,
          visible: false,
          preventOverflow: true,
          backgroundColor: PET_WINDOW_TRANSPARENT_COLOR,
        });

        petWindow.once('tauri://created', () => {
          const { petSettings: s, isAgentRunning: a } = latestStateRef.current;
          windowPositionFromNativeRef.current = s.windowPosition;
          void emitPetWindowState({ settings: s, isAgentRunning: a });
        });
        petWindow.once('tauri://error', (event) => {
          if (import.meta.env.DEV) {
            console.error('[Pets] Failed to create pet window:', event.payload);
          }
        });
        return;
      }

      await existingWindow.show().catch((error) => {
        if (import.meta.env.DEV) {
          console.error('[Pets] Failed to show pet window:', error);
        }
      });
      await existingWindow.setAlwaysOnTop(true).catch((error) => {
        if (import.meta.env.DEV) {
          console.error('[Pets] Failed to keep pet window on top:', error);
        }
      });
      await existingWindow
        .setBackgroundColor(PET_WINDOW_TRANSPARENT_COLOR)
        .catch((error) => {
          if (import.meta.env.DEV) {
            console.error(
              '[Pets] Failed to make pet window background transparent:',
              error,
            );
          }
        });

      if (
        !sameWindowPosition(
          windowPositionFromNativeRef.current,
          petSettings.windowPosition,
        )
      ) {
        await existingWindow
          .setPosition(
            new LogicalPosition(
              petSettings.windowPosition.x,
              petSettings.windowPosition.y,
            ),
          )
          .catch((error) => {
            if (import.meta.env.DEV) {
              console.error('[Pets] Failed to move pet window:', error);
            }
          });
      }

      windowPositionFromNativeRef.current = petSettings.windowPosition;
      await emitPetWindowState({ settings: petSettings, isAgentRunning });
    }

    syncPetWindow()
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.error('[Pets] Failed to sync pet window:', error);
        }
      })
      .finally(() => {
        ensuringPetWindowRef.current = false;
      });

    return () => {
      cancelled = true;
      ensuringPetWindowRef.current = false;
    };
  }, [emitPetWindowState, isAgentRunning, isNative, petSettings]);

  useEffect(() => {
    if (!isNative || !petSettings.enabled) return;

    void emitPetWindowState({ settings: petSettings, isAgentRunning });
  }, [emitPetWindowState, isAgentRunning, isNative, petSettings]);

  return (
    <>
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialCategory="pets"
      />
      {petSettings.enabled &&
        !isNative &&
        createPortal(
          <PetOverlay
            pet={pet}
            settings={petSettings}
            isAgentRunning={isAgentRunning}
            onDisable={() => updatePetSettings({ enabled: false })}
            onOpenSettings={() => setSettingsOpen(true)}
            onPositionChange={handlePositionChange}
          />,
          document.body,
        )}
    </>
  );
}

function normalizePetWindowPatch(
  payload: unknown,
): Partial<PetSettingsConfig> | null {
  if (!isObject(payload)) return null;

  const patch: Partial<PetSettingsConfig> = {};

  if (typeof payload.enabled === 'boolean') {
    patch.enabled = payload.enabled;
  }
  if (typeof payload.activePetId === 'string') {
    patch.activePetId = payload.activePetId;
  }
  if (
    payload.activePetSource === 'builtin' ||
    payload.activePetSource === 'custom'
  ) {
    patch.activePetSource = payload.activePetSource;
  }
  if ('customPet' in payload) {
    patch.customPet =
      payload.customPet === null ? null : normalizeCustomPet(payload.customPet);
  }
  if (typeof payload.showAgentActivity === 'boolean') {
    patch.showAgentActivity = payload.showAgentActivity;
  }
  if (isPetWindowPosition(payload.windowPosition)) {
    patch.windowPosition = payload.windowPosition;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function isPetWindowPosition(value: unknown): value is PetWindowPosition {
  return (
    isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
