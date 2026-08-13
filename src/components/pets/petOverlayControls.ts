import type { PetInteraction } from '@/shared/pets/pets';

const DRAG_AXIS_BIAS = 1.18;
const NUDGE_PX = 16;

export function classifyPetDrag(dx: number, dy: number): PetInteraction {
  if (Math.abs(dx) > Math.abs(dy) * DRAG_AXIS_BIAS) {
    return dx > 0 ? 'drag-left' : 'drag-right';
  }

  if (Math.abs(dy) > Math.abs(dx) * DRAG_AXIS_BIAS) {
    return dy > 0 ? 'drag-down' : 'drag-up';
  }

  return dx > 0 ? 'drag-left' : 'drag-right';
}

export function getPetKeyDelta(key: string) {
  switch (key) {
    case 'ArrowLeft':
      return { right: NUDGE_PX, bottom: 0 };
    case 'ArrowRight':
      return { right: -NUDGE_PX, bottom: 0 };
    case 'ArrowUp':
      return { right: 0, bottom: NUDGE_PX };
    case 'ArrowDown':
      return { right: 0, bottom: -NUDGE_PX };
    default:
      return null;
  }
}
