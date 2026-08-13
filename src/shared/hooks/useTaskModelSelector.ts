import { useCallback, useState } from 'react';

import { DEFAULT_MODEL_ID } from '@/components/shared/ModelPicker';

const STORAGE_KEY_PREFIX = 'task_model_';

function readStoredModel(taskId: string): string {
  try {
    return (
      localStorage.getItem(`${STORAGE_KEY_PREFIX}${taskId}`) ?? DEFAULT_MODEL_ID
    );
  } catch {
    return DEFAULT_MODEL_ID;
  }
}

/**
 * Persists the selected model for a specific task in localStorage.
 * Returns [modelId, setModelId] — the model is scoped to `taskId`.
 *
 * Used by the V2 route to forward `modelConfig` to the AG-UI backend.
 */
export function useTaskModelSelector(
  taskId: string,
): [string, (id: string) => void] {
  const [modelId, setModelIdState] = useState<string>(() =>
    readStoredModel(taskId),
  );

  const setModelId = useCallback(
    (id: string) => {
      setModelIdState(id);
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${taskId}`, id);
      } catch {
        // localStorage unavailable — no-op
      }
    },
    [taskId],
  );

  return [modelId, setModelId];
}
