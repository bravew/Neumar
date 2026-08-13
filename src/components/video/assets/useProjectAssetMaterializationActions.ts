import { useCallback, useMemo } from 'react';

import { isAssetMaterializationBudgetError } from '@/shared/assets';
import type { AssetMaterializationBudgetError } from '@/shared/assets';

import type { VideoProjectEditorActions } from '../editorTypes';

// Wires the rail tile's cancel-X and retry buttons to the project
// hydrate / cancel actions. Centralised so `ProjectAssetsSection`
// doesn't grow past the component-size cap and so any other rail
// surface (project browser dialog, render queue) can reuse the same
// handlers later.
export function useProjectAssetMaterializationActions(params: {
  actions: VideoProjectEditorActions;
  sessionId: string;
  onBudgetIssue: (error: AssetMaterializationBudgetError) => void;
  onError: (error: unknown) => void;
}) {
  const { actions, sessionId, onBudgetIssue, onError } = params;
  const handleCancel = useCallback(
    (mediaItemId: string) => {
      void actions.cancelProjectAssetHydration(mediaItemId).catch(onError);
    },
    [actions, onError],
  );
  const handleRetry = useCallback(
    (mediaItemId: string) => {
      void actions
        .hydrateProjectAsset(mediaItemId, { sessionId })
        .catch((error) => {
          if (isAssetMaterializationBudgetError(error)) {
            onBudgetIssue(error);
          } else {
            onError(error);
          }
        });
    },
    [actions, onBudgetIssue, onError, sessionId],
  );
  return useMemo(
    () => ({ onCancel: handleCancel, onRetry: handleRetry }),
    [handleCancel, handleRetry],
  );
}
