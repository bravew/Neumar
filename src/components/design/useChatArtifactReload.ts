import { useCallback, useEffect, useRef, useState } from 'react';

import type { DesignProject } from '@/shared/types/design-mode';

/**
 * A design-chat agent run writes artifacts (e.g. `index.html`) straight into the
 * project root, but the file watcher doesn't always surface them live. This hook
 * returns a signal that increments on the run's completion edge (`sending`
 * true→false) so the FileWorkspace refetches and the new artifact appears
 * without a manual page reload.
 */
export function useChatArtifactReload(sending: boolean): number {
  const [signal, setSignal] = useState(0);
  const prevSendingRef = useRef(false);
  useEffect(() => {
    if (prevSendingRef.current && !sending) {
      setSignal((n) => n + 1);
    }
    prevSendingRef.current = sending;
  }, [sending]);
  return signal;
}

/**
 * When a chat run registers an artifact, the server pushes the updated project.
 * This hook refreshes project state (→ Creations grid) and auto-opens the newest
 * artifact, returning the `onProject` handler to hand to `useDesignChat`.
 */
export function useChatArtifactAutoOpen({
  onProjectChange,
  openProjectFile,
}: {
  onProjectChange: (project: DesignProject) => void;
  openProjectFile: (filePath: string) => void;
}): { onProject: (project: unknown) => void } {
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const onProject = useCallback(
    (next: unknown) => {
      const updated = next as DesignProject;
      onProjectChange(updated);
      const newest = updated.outputs?.[0]?.path;
      if (newest) setPendingPath(newest);
    },
    [onProjectChange],
  );
  useEffect(() => {
    if (pendingPath) {
      openProjectFile(pendingPath);
      setPendingPath(null);
    }
  }, [pendingPath, openProjectFile]);
  return { onProject };
}
