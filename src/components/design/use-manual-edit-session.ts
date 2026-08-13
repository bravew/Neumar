import { useEffect, useReducer, useState } from 'react';

import type {
  InspectStylePatch,
  InspectStyleProp,
  NeumaTargetPayload,
} from '@/components/artifacts/live/iframe-sandbox';
import {
  applyDesignEditPatch,
  listDesignEditPatches,
  readDesignFile,
  revertDesignEditPatch,
} from '@/shared/hooks/useDesignMode';
import { randomUUID } from '@/shared/utils/uuid';

import {
  initialManualEditState,
  isAppliedManualEditPatch,
  manualEditReducer,
} from './edit/manual-edit-reducer';
import { formatJsonFileTextForDisplay } from './file-viewer-utils';
import type { PreviewMode } from './PreviewModeSegments';

export function useManualEditSession({
  projectId,
  path,
  effectiveMode,
  target,
  setContent,
  setInspectPatch,
}: {
  projectId: string;
  path: string | null;
  effectiveMode: PreviewMode;
  target: NeumaTargetPayload | null;
  setContent: (content: string) => void;
  setInspectPatch: (patch: InspectStylePatch | null) => void;
}) {
  const [state, dispatch] = useReducer(
    manualEditReducer,
    initialManualEditState,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (effectiveMode !== 'edit') return;
    const ac = new AbortController();
    listDesignEditPatches(projectId, { signal: ac.signal })
      .then((result) =>
        dispatch({ type: 'historyLoaded', entries: result.patches }),
      )
      .catch(() => {});
    return () => ac.abort();
  }, [effectiveMode, projectId]);

  useEffect(() => {
    if (effectiveMode === 'edit' && target) {
      dispatch({ type: 'pointerSelected', target });
    }
  }, [effectiveMode, target]);

  const updateDraft = (property: InspectStyleProp, value: string) => {
    dispatch({ type: 'propertyChanged', property, value });
    if (target) setInspectPatch({ id: target.id, prop: property, value });
  };

  const refreshContent = async () => {
    if (!path) return;
    const file = await readDesignFile(projectId, path);
    setContent(formatJsonFileTextForDisplay(path, file.content));
  };

  const apply = async () => {
    if (!target || !path) return;
    setSaving(true);
    try {
      const result = await applyDesignEditPatch(projectId, {
        type: 'set-style',
        sourcePath: path,
        targetId: target.id,
        styles: { [state.draft.property]: state.draft.value },
      });
      dispatch({ type: 'editApplied', entry: result.patch });
      await refreshContent();
    } finally {
      setSaving(false);
    }
  };

  const revert = async (patchId: string) => {
    setSaving(true);
    try {
      const result = await revertDesignEditPatch(projectId, patchId);
      dispatch({ type: 'editReverted', entry: result.patch });
      await refreshContent();
    } finally {
      setSaving(false);
    }
  };

  const reapply = async (patchId: string) => {
    const entry = state.entries.find(
      (item) => item.patchId === patchId && isAppliedManualEditPatch(item),
    );
    if (!entry || !isAppliedManualEditPatch(entry)) return;
    setSaving(true);
    try {
      const result = await applyDesignEditPatch(projectId, {
        ...entry.patch,
        patchId: `patch_${randomUUID()}`,
      });
      dispatch({ type: 'editReapplied', entry: result.patch });
      await refreshContent();
    } finally {
      setSaving(false);
    }
  };

  const setHistoryOpen = (open: boolean) => {
    dispatch({ type: open ? 'historyOpened' : 'historyClosed' });
  };

  return { state, saving, updateDraft, apply, revert, reapply, setHistoryOpen };
}
