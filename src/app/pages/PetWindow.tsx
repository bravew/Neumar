import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EyeOff, Settings } from 'lucide-react';

import { PetSpriteFace } from '@/components/pets/PetSpriteFace';
import {
  PET_EVENT_OPEN_SETTINGS,
  PET_EVENT_PATCH,
  PET_EVENT_STATE,
  PET_WINDOW_TRANSPARENT_COLOR,
  type PetWindowPatchPayload,
  type PetWindowStatePayload,
} from '@/components/pets/tauriPetWindow';
import { useReducedMotion } from '@/components/pets/useReducedMotion';
import { getSettings, type PetSettingsConfig } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { getPetForSettings } from '@/shared/pets/catalog';
import type { PetInteraction } from '@/shared/pets/pets';
import { normalizePetSettings } from '@/shared/pets/settings';
import { useLanguage } from '@/shared/providers/language-provider';

const MOVE_PERSIST_DEBOUNCE_MS = 180;
const KEYBOARD_MOVE_STEP = 24;

export function PetWindowPage() {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();
  const [petSettings, setPetSettings] = useState<PetSettingsConfig>(() =>
    normalizePetSettings(getSettings().pets),
  );
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [interaction, setInteraction] = useState<PetInteraction>('idle');
  const movePersistTimerRef = useRef<number | null>(null);
  const pet = useMemo(() => getPetForSettings(petSettings), [petSettings]);

  const emitPatch = useCallback(async (patch: PetWindowPatchPayload) => {
    try {
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo('main', PET_EVENT_PATCH, patch);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[Pets] Failed to send pet window patch:', error);
      }
    }
  }, []);

  const openSettings = useCallback(async () => {
    try {
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo('main', PET_EVENT_OPEN_SETTINGS);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[Pets] Failed to open pet settings:', error);
      }
    }
  }, []);

  const showMainWindow = useCallback(async () => {
    try {
      const { Window } = await import('@tauri-apps/api/window');
      const mainWindow = await Window.getByLabel('main');
      if (!mainWindow) return;

      await mainWindow.unminimize().catch(() => {});
      await mainWindow.show();
      await mainWindow.setFocus();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[Pets] Failed to show main window:', error);
      }
    }
  }, []);

  const startDragging = useCallback(
    async (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      if (event.detail > 1) {
        await showMainWindow();
        return;
      }

      setInteraction('hover');

      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('[Pets] Failed to drag pet window:', error);
        }
      }
    },
    [showMainWindow],
  );

  const moveByKeyboard = useCallback(async (deltaX: number, deltaY: number) => {
    try {
      const { emitTo } = await import('@tauri-apps/api/event');
      const { getCurrentWindow, LogicalPosition } =
        await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      const [scaleFactor, physicalPosition] = await Promise.all([
        currentWindow.scaleFactor(),
        currentWindow.outerPosition(),
      ]);
      const logicalPosition = physicalPosition.toLogical(scaleFactor);
      const windowPosition = {
        x: Math.round(logicalPosition.x + deltaX),
        y: Math.round(logicalPosition.y + deltaY),
      };

      await currentWindow.setPosition(
        new LogicalPosition(windowPosition.x, windowPosition.y),
      );
      await emitTo('main', PET_EVENT_PATCH, { windowPosition });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[Pets] Failed to move pet window:', error);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenState: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;

    async function setupPetWindow() {
      const [{ listen }, { getCurrentWindow }, { getCurrentWebviewWindow }] =
        await Promise.all([
          import('@tauri-apps/api/event'),
          import('@tauri-apps/api/window'),
          import('@tauri-apps/api/webviewWindow'),
        ]);
      if (cancelled) return;

      unlistenState = await listen<PetWindowStatePayload>(
        PET_EVENT_STATE,
        ({ payload }) => {
          if (!isPetWindowStatePayload(payload)) return;
          setPetSettings(normalizePetSettings(payload.settings));
          setIsAgentRunning(payload.isAgentRunning);
        },
      );

      const currentWindow = getCurrentWindow();
      unlistenMoved = await currentWindow.onMoved(({ payload }) => {
        const physicalPosition = { x: payload.x, y: payload.y };

        if (movePersistTimerRef.current) {
          window.clearTimeout(movePersistTimerRef.current);
        }

        movePersistTimerRef.current = window.setTimeout(async () => {
          try {
            const scaleFactor = await currentWindow.scaleFactor();
            const logicalPosition = payload.toLogical(scaleFactor);
            await emitPatch({
              windowPosition: {
                x: Math.round(logicalPosition.x),
                y: Math.round(logicalPosition.y),
              },
            });
          } catch (error) {
            if (import.meta.env.DEV) {
              console.error(
                '[Pets] Failed to persist pet window position:',
                error,
                physicalPosition,
              );
            }
          }
        }, MOVE_PERSIST_DEBOUNCE_MS);
      });

      await getCurrentWebviewWindow()
        .setBackgroundColor(PET_WINDOW_TRANSPARENT_COLOR)
        .catch((error) => {
          if (import.meta.env.DEV) {
            console.error(
              '[Pets] Failed to make pet window background transparent:',
              error,
            );
          }
        });
      await currentWindow.show();
    }

    setupPetWindow().catch((error) => {
      if (import.meta.env.DEV) {
        console.error('[Pets] Failed to initialize pet window:', error);
      }
    });

    return () => {
      cancelled = true;
      unlistenState?.();
      unlistenMoved?.();
      if (movePersistTimerRef.current) {
        window.clearTimeout(movePersistTimerRef.current);
      }
    };
  }, [emitPatch]);

  const displayedInteraction =
    petSettings.showAgentActivity && isAgentRunning ? 'waiting' : interaction;
  const displayedAmbientRowId =
    petSettings.showAgentActivity && isAgentRunning ? 'running' : null;

  if (!petSettings.enabled) {
    return null;
  }

  return (
    <main
      aria-label={t.settings.petLandmark}
      className="group relative flex h-screen w-screen items-center justify-center overflow-hidden bg-transparent"
      data-pet-state={displayedInteraction}
      data-pet-ambient={displayedAmbientRowId ?? ''}
    >
      <div className="pointer-events-none absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <PetWindowIconButton
          label={t.settings.petOpenSettings}
          onClick={openSettings}
        >
          <Settings className="size-4" aria-hidden />
        </PetWindowIconButton>
        <PetWindowIconButton
          label={t.settings.petHide}
          onClick={() => emitPatch({ enabled: false })}
        >
          <EyeOff className="size-4" aria-hidden />
        </PetWindowIconButton>
      </div>

      <button
        type="button"
        className={cn(
          'grid size-24 touch-none place-items-center bg-transparent p-0',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
        aria-label={t.settings.petSpriteAria.replace('{name}', pet.name)}
        onPointerDown={startDragging}
        onPointerUp={() => setInteraction('idle')}
        onPointerCancel={() => setInteraction('idle')}
        onFocus={() => setInteraction('hover')}
        onBlur={() => setInteraction('idle')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void openSettings();
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            void emitPatch({ enabled: false });
            return;
          }

          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            void moveByKeyboard(-KEYBOARD_MOVE_STEP, 0);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            void moveByKeyboard(KEYBOARD_MOVE_STEP, 0);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            void moveByKeyboard(0, -KEYBOARD_MOVE_STEP);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            void moveByKeyboard(0, KEYBOARD_MOVE_STEP);
          }
        }}
      >
        <PetSpriteFace
          pet={pet}
          interaction={displayedInteraction}
          ambientRowId={displayedAmbientRowId}
          reducedMotion={reducedMotion}
        />
      </button>
    </main>
  );
}

function PetWindowIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="text-foreground/80 hover:text-foreground focus-visible:ring-ring pointer-events-auto grid size-7 place-items-center rounded-md bg-transparent drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.45)] focus-visible:ring-2 focus-visible:outline-none"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function isPetWindowStatePayload(
  payload: unknown,
): payload is PetWindowStatePayload {
  return (
    isObject(payload) &&
    isObject(payload.settings) &&
    typeof payload.isAgentRunning === 'boolean'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
