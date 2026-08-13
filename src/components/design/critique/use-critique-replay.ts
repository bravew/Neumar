import { useMemo } from 'react';

import type { PanelEvent } from '@/shared/types/design-mode';

import { initialCritiqueState, reduceCritiqueEvents } from './critique-reducer';

export function useCritiqueReplay(events: Iterable<PanelEvent> | null) {
  return useMemo(
    () => (events ? reduceCritiqueEvents(events) : initialCritiqueState),
    [events],
  );
}
