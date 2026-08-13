import { useCallback, useEffect, useRef, useState } from 'react';

import { EyeOff, Settings, X } from 'lucide-react';

import type { PetPosition, PetSettingsConfig } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import type { PetCatalogItem } from '@/shared/pets/catalog';
import { getPetGreeting } from '@/shared/pets/i18n';
import {
  pickAmbientRowId,
  randomBetween,
  type PetInteraction,
} from '@/shared/pets/pets';
import { useLanguage } from '@/shared/providers/language-provider';

import { classifyPetDrag, getPetKeyDelta } from './petOverlayControls';
import { PetSpriteFace } from './PetSpriteFace';
import { clampPosition, usePetPosition } from './usePetPosition';
import { useReducedMotion } from './useReducedMotion';

const DRAG_GESTURE_MIN_PX = 14;
const WAITING_AFTER_MS = 45_000;
const AMBIENT_MIN_MS = 9_000;
const AMBIENT_MAX_MS = 18_000;
const AMBIENT_PLAY_MS = 2_000;
const AGENT_FEEDBACK_CLEAR_MS = 2_800;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startRight: number;
  startBottom: number;
  moved: boolean;
} | null;

interface PetOverlayProps {
  pet: PetCatalogItem;
  settings: PetSettingsConfig;
  isAgentRunning: boolean;
  onDisable: () => void;
  onOpenSettings: () => void;
  onPositionChange: (position: PetPosition) => void;
}

export function PetOverlay({
  pet,
  settings,
  isAgentRunning,
  onDisable,
  onOpenSettings,
  onPositionChange,
}: PetOverlayProps) {
  const { t } = useLanguage();
  const { position, positionRef, setPosition, persistCurrentPosition } =
    usePetPosition(settings.position, onPositionChange);
  const reducedMotion = useReducedMotion();
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [interaction, setInteraction] = useState<PetInteraction>('idle');
  const [ambientRowId, setAmbientRowId] = useState<string | null>(null);
  const [agentInteraction, setAgentInteraction] =
    useState<PetInteraction>('idle');
  const [agentAmbientRowId, setAgentAmbientRowId] = useState<string | null>(
    null,
  );
  const dragRef = useRef<DragState>(null);
  const wasAgentRunningRef = useRef(false);
  const clearAgentFeedbackRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clearAgentFeedbackRef.current) {
        window.clearTimeout(clearAgentFeedbackRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!settings.showAgentActivity) {
      wasAgentRunningRef.current = isAgentRunning;
      setAgentInteraction('idle');
      setAgentAmbientRowId(null);
      return;
    }

    if (clearAgentFeedbackRef.current) {
      window.clearTimeout(clearAgentFeedbackRef.current);
      clearAgentFeedbackRef.current = null;
    }

    if (isAgentRunning) {
      wasAgentRunningRef.current = true;
      setAgentInteraction('waiting');
      setAgentAmbientRowId('running');
      return;
    }

    if (wasAgentRunningRef.current) {
      wasAgentRunningRef.current = false;
      setAgentInteraction('hover');
      setAgentAmbientRowId('waving');
      clearAgentFeedbackRef.current = window.setTimeout(() => {
        setAgentInteraction('idle');
        setAgentAmbientRowId(null);
        clearAgentFeedbackRef.current = null;
      }, AGENT_FEEDBACK_CLEAR_MS);
    }
  }, [isAgentRunning, settings.showAgentActivity]);

  useEffect(() => {
    if (reducedMotion || isAgentRunning) return;

    const waitingId = window.setTimeout(() => {
      setInteraction((current) => (current === 'idle' ? 'waiting' : current));
    }, WAITING_AFTER_MS);

    return () => window.clearTimeout(waitingId);
  }, [isAgentRunning, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || interaction !== 'idle' || isAgentRunning) return;

    const delay = randomBetween(AMBIENT_MIN_MS, AMBIENT_MAX_MS);
    let playId: number | undefined;
    const restId = window.setTimeout(() => {
      const row = pickAmbientRowId(pet.atlasLayout, ambientRowId);
      if (!row) return;

      setAmbientRowId(row);
      playId = window.setTimeout(() => {
        setAmbientRowId(null);
      }, AMBIENT_PLAY_MS);
    }, delay);

    return () => {
      window.clearTimeout(restId);
      if (playId) window.clearTimeout(playId);
    };
  }, [
    ambientRowId,
    interaction,
    isAgentRunning,
    pet.atlasLayout,
    reducedMotion,
  ]);

  const resetIdle = useCallback(() => {
    setInteraction('idle');
    setAmbientRowId(null);
  }, []);

  const updatePositionFromPointer = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const next = {
        right: drag.startRight - dx,
        bottom: drag.startBottom - dy,
      };

      setPosition(next);

      if (
        Math.abs(dx) > DRAG_GESTURE_MIN_PX ||
        Math.abs(dy) > DRAG_GESTURE_MIN_PX
      ) {
        drag.moved = true;
        setInteraction(classifyPetDrag(dx, dy));
      }
    },
    [setPosition],
  );

  const finishDrag = useCallback(
    (toggleBubble: boolean) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;

      if (toggleBubble && !drag.moved) {
        setBubbleOpen((open) => !open);
      }

      persistCurrentPosition();
      resetIdle();
    },
    [persistCurrentPosition, resetIdle],
  );

  const canApplyAgentFeedback = interaction === 'idle' && !dragRef.current;
  const displayedInteraction =
    canApplyAgentFeedback && agentInteraction !== 'idle'
      ? agentInteraction
      : interaction;
  const displayedAmbientRowId = canApplyAgentFeedback
    ? (agentAmbientRowId ?? ambientRowId)
    : ambientRowId;

  return (
    <aside
      role="complementary"
      aria-label={t.settings.petLandmark}
      className="pointer-events-none fixed z-50"
      data-pet-state={displayedInteraction}
      data-pet-ambient={displayedAmbientRowId ?? ''}
      style={{ right: position.right, bottom: position.bottom }}
    >
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {bubbleOpen && (
          <div
            role="status"
            aria-live="polite"
            className="bg-popover text-popover-foreground border-border w-[min(18rem,calc(100vw-2rem))] rounded-lg border p-3 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{pet.name}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {getPetGreeting(pet, t)}
                </p>
              </div>

              <button
                type="button"
                className="hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-md"
                aria-label={t.settings.petCloseBubble}
                onClick={() => setBubbleOpen(false)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="mt-3 flex justify-end gap-1">
              <button
                type="button"
                className="hover:bg-accent flex size-8 items-center justify-center rounded-md"
                aria-label={t.settings.petOpenSettings}
                onClick={onOpenSettings}
              >
                <Settings className="size-4" aria-hidden />
              </button>

              <button
                type="button"
                className="hover:bg-accent flex size-8 items-center justify-center rounded-md"
                aria-label={t.settings.petHide}
                onClick={onDisable}
              >
                <EyeOff className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          className={cn(
            'grid touch-none place-items-center bg-transparent p-0',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
          aria-label={t.settings.petSpriteAria.replace('{name}', pet.name)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              startRight: positionRef.current.right,
              startBottom: positionRef.current.bottom,
              moved: false,
            };
            setInteraction('hover');
          }}
          onPointerMove={updatePositionFromPointer}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) {
              event.currentTarget.releasePointerCapture(event.pointerId);
              finishDrag(true);
            }
          }}
          onPointerCancel={() => finishDrag(false)}
          onLostPointerCapture={() => finishDrag(false)}
          onFocus={() => setInteraction('hover')}
          onBlur={resetIdle}
          onKeyDown={(event) =>
            handleKeyDown(
              event,
              positionRef.current,
              setPosition,
              (next) => {
                onPositionChange(next);
              },
              setBubbleOpen,
            )
          }
        >
          <PetSpriteFace
            pet={pet}
            interaction={displayedInteraction}
            ambientRowId={displayedAmbientRowId}
            reducedMotion={reducedMotion}
          />
        </button>
      </div>
    </aside>
  );
}

function handleKeyDown(
  event: React.KeyboardEvent<HTMLButtonElement>,
  currentPosition: PetPosition,
  setPosition: (position: PetPosition) => void,
  persistPosition: (position: PetPosition) => void,
  setBubbleOpen: React.Dispatch<React.SetStateAction<boolean>>,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    setBubbleOpen((open) => !open);
    return;
  }

  if (event.key === 'Escape') {
    setBubbleOpen(false);
    return;
  }

  const delta = getPetKeyDelta(event.key);
  if (!delta) return;

  event.preventDefault();
  const next = {
    right: currentPosition.right + delta.right,
    bottom: currentPosition.bottom + delta.bottom,
  };
  const clamped = clampPosition(next);
  setPosition(clamped);
  persistPosition(clamped);
}
