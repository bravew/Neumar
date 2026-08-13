import { useMemo, useSyncExternalStore } from 'react';

import { API_BASE_URL } from '@/config';
import type { PanelEvent } from '@/shared/types/design-mode';

import {
  critiqueReducer,
  initialCritiqueState,
  type CritiqueState,
} from './critique-reducer';

interface CritiqueStreamStore {
  getSnapshot: () => CritiqueState;
  subscribe: (notify: () => void) => () => void;
}

export function useCritiqueStream(
  projectId: string,
  runId: string | null,
  enabled: boolean,
) {
  const store = useMemo(
    () => createCritiqueEventsStore(projectId, runId, enabled),
    [enabled, projectId, runId],
  );
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

export function createCritiqueEventsStore(
  projectId: string,
  runId: string | null,
  enabled: boolean,
): CritiqueStreamStore {
  let snapshot = initialCritiqueState;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (!enabled || !runId) {
        return () => listeners.delete(listener);
      }

      const source = new EventSource(
        `${API_BASE_URL}/design/projects/${encodeURIComponent(
          projectId,
        )}/design-jury/${encodeURIComponent(runId)}/events`,
      );
      source.onmessage = (message) => {
        const event = parsePanelEvent(message.data);
        if (!event) return;
        const next = critiqueReducer(snapshot, event);
        if (Object.is(next, snapshot)) return;
        snapshot = next;
        notify();
      };
      source.addEventListener('done', () => source.close());

      return () => {
        listeners.delete(listener);
        source.close();
      };
    },
  };
}

function parsePanelEvent(data: string): PanelEvent | null {
  try {
    const parsed = JSON.parse(data) as PanelEvent;
    return parsed && typeof parsed.type === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
