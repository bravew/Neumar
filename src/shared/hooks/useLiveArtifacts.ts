import { useCallback, useEffect, useState } from 'react';

import {
  applyArtifactEvent,
  EMPTY_ARTIFACT_MAP,
} from '@/shared/artifacts/reducer';
import type { ArtifactMap } from '@/shared/artifacts/reducer';
import { useSetting } from '@/shared/db/settings';
import { useTaskEventSource } from '@/shared/hooks/useTaskEventSource';
import { isArtifactEvent } from '@/shared/types/artifact';

/**
 * Folds streaming `artifact.*` events into a snapshot map. Returns an
 * empty map when the `artifactsV2` flag is off — callers can mount
 * unconditionally and treat empty as disabled.
 */
export function useLiveArtifacts(
  taskId: string | undefined,
  isRunning: boolean,
): ArtifactMap {
  const enabled = useSetting('artifactsV2');
  const [artifacts, setArtifacts] = useState<ArtifactMap>(EMPTY_ARTIFACT_MAP);

  // Drop the previous task's artifacts on navigation; a late event from
  // the old subscription can't pollute the new task's panel.
  useEffect(() => {
    setArtifacts(EMPTY_ARTIFACT_MAP);
  }, [taskId]);

  const onMessage = useCallback((msg: Record<string, unknown>) => {
    if (!isArtifactEvent(msg)) return;
    setArtifacts((prev) => applyArtifactEvent(prev, msg));
  }, []);

  useTaskEventSource(enabled ? taskId : undefined, isRunning, onMessage);

  return artifacts;
}
