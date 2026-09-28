import { useCallback, useEffect, useState } from 'react';

import { createFile } from '@/shared/db';
import type { ResourceLink } from '@/shared/hooks/agent-types';
import {
  applyStreamSignal,
  dismissStreamNotice,
  EMPTY_STREAM_SIGNAL_STATE,
  isStreamSignal,
  resourceLinkToFile,
  STREAM_SIGNAL_EVENT_NAME,
  type StreamSignalState,
} from '@/shared/lib/stream-signals';
import { randomUUID } from '@/shared/utils/uuid';

import { getFileTypeFromPath } from './agent-files';

/** Minimal slice of the AG-UI agent this hook needs. */
export interface StreamSignalSource {
  subscribe(subscriber: {
    onCustomEvent?: (params: {
      event: { name: string; value?: unknown };
    }) => void;
  }): { unsubscribe: () => void };
}

/**
 * Registers files an MCP tool returned by reference so they render as
 * artifacts (useV2Artifacts reloads on `task-files-updated`).
 */
async function registerResourceLinks(
  taskId: string,
  links: ResourceLink[],
): Promise<void> {
  let registered = false;
  for (const link of links) {
    const file = resourceLinkToFile(link);
    if (!file) continue;
    try {
      await createFile({
        task_id: taskId,
        name: file.name,
        type: getFileTypeFromPath(file.path),
        path: file.path,
      });
      registered = true;
    } catch {
      // Non-critical — the tool result itself is still shown.
    }
  }
  if (registered) window.dispatchEvent(new CustomEvent('task-files-updated'));
}

/**
 * Subscribes to `neuma.stream_signal` CUSTOM events on the task's AG-UI
 * agent and exposes notice / retry / session state for the thread.
 */
export function useStreamSignals(
  agent: StreamSignalSource,
  taskId: string | undefined,
): {
  state: StreamSignalState;
  dismissNotice: (id: string) => void;
  clearRetry: () => void;
} {
  const [state, setState] = useState<StreamSignalState>(
    EMPTY_STREAM_SIGNAL_STATE,
  );

  // Callers key this hook's owner by taskId so state starts empty per task.
  useEffect(() => {
    const sub = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== STREAM_SIGNAL_EVENT_NAME) return;
        const signal = event.value;
        if (!isStreamSignal(signal)) return;
        if (signal.kind === 'resource_links') {
          if (taskId) void registerResourceLinks(taskId, signal.links);
          return;
        }
        const now = Date.now();
        const id = randomUUID();
        setState((prev) => applyStreamSignal(prev, signal, now, id));
      },
    });
    return () => sub.unsubscribe();
  }, [agent, taskId]);

  const dismissNotice = useCallback((id: string) => {
    setState((prev) => dismissStreamNotice(prev, id));
  }, []);

  const clearRetry = useCallback(() => {
    setState((prev) => ({ ...prev, retry: null }));
  }, []);

  return { state, dismissNotice, clearRetry };
}
