import type { FrameworkSlotFallback } from '@/shared/video/types';

import type { BoundSlot } from './bind';

export const FALLBACK_COST_CENTS: Record<
  FrameworkSlotFallback['kind'],
  number
> = {
  'ask-user': 0,
  'ai-image': 8,
  'ai-clip': 40,
  'broll-search': 5,
  'tts-narration': 15,
};

export interface FrameworkGap {
  sectionId: string;
  slotId: string;
  required: boolean;
  fallback: FrameworkSlotFallback;
  estimatedCents: number;
}

export function reportFrameworkGaps(bindings: BoundSlot[]): FrameworkGap[] {
  return bindings
    .filter((binding) => binding.chosen === null)
    .map((binding) => ({
      sectionId: binding.sectionId,
      slotId: binding.slot.id,
      required: binding.slot.required,
      fallback: binding.slot.fallback,
      estimatedCents: FALLBACK_COST_CENTS[binding.slot.fallback.kind],
    }));
}
