import { useMemo, useState } from 'react';

import type { VideoProjectEditorActions } from './editorTypes';

export function useRegeneratingSceneActions(
  actions: VideoProjectEditorActions,
): {
  editorActions: VideoProjectEditorActions;
  regeneratingSceneIds: Set<string>;
} {
  const [regeneratingSceneIds, setRegeneratingSceneIds] = useState<Set<string>>(
    () => new Set(),
  );
  const editorActions = useMemo<VideoProjectEditorActions>(
    () => ({
      ...actions,
      regenerateScene: async (sceneId, input) => {
        setRegeneratingSceneIds((prev) => new Set(prev).add(sceneId));
        try {
          return await actions.regenerateScene(sceneId, input);
        } finally {
          setRegeneratingSceneIds((prev) => {
            const next = new Set(prev);
            next.delete(sceneId);
            return next;
          });
        }
      },
    }),
    [actions],
  );
  return { editorActions, regeneratingSceneIds };
}
