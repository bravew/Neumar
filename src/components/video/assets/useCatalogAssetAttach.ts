import {
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { toast } from 'sonner';

import {
  applyAssetMaterializationBudgetIncrease,
  isAssetMaterializationBudgetError,
  readAssetDragPayload,
  type AssetMaterializationBudgetError,
} from '@/shared/assets';
import {
  ASSET_MATERIALIZATION_NOTICE_TTL_MS,
  useLatestMaterializationState,
  type MaterializationStateMap,
} from '@/shared/hooks/useAssetMaterializationEvents';

import type { VideoProjectEditorActions } from '../editorTypes';

interface CatalogAssetAttachLabels {
  attachQueuedToast: string;
  attachSucceededToast: string;
  attachPartialToast: string;
  materializeFailed: string;
}

/**
 * Owns the catalog-asset-attach lifecycle: batch attach (drag-drop or picker
 * selection), budget-exceeded recovery, and the transient "attaching…"
 * notice state. Extracted from `ProjectAssetsSection` — that component still
 * renders `AssetMaterializationNotice` and needs `budgetIssue`/`attaching`/
 * `materializationState` for it, so those come back out rather than staying
 * fully internal.
 */
export function useCatalogAssetAttach({
  actions,
  labels,
  materializeSessionId,
  materializationStates,
}: {
  actions: VideoProjectEditorActions;
  labels: CatalogAssetAttachLabels;
  materializeSessionId: string;
  materializationStates: MaterializationStateMap;
}) {
  const [attaching, setAttaching] = useState(false);
  const [budgetIssue, setBudgetIssue] =
    useState<AssetMaterializationBudgetError | null>(null);
  const [budgetIncreasing, setBudgetIncreasing] = useState(false);
  const [activeAssetIds, setActiveAssetIds] = useState<string[]>([]);
  const pendingBudgetAssetIdsRef = useRef<string[]>([]);
  const activeAssetClearTimerRef = useRef<number | null>(null);
  const materializationState = useLatestMaterializationState(
    materializationStates,
    activeAssetIds,
  );

  useEffect(
    () => () => {
      if (activeAssetClearTimerRef.current) {
        window.clearTimeout(activeAssetClearTimerRef.current);
      }
    },
    [],
  );

  const showAttachError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(labels.materializeFailed.replace('{message}', message));
    },
    [labels.materializeFailed],
  );

  const attachCatalogAssetIds = useCallback(
    async (assetIds: string[]) => {
      const results = await Promise.allSettled(
        assetIds.map((assetId) =>
          actions.attachCatalogAsset(assetId, {
            sessionId: materializeSessionId,
          }),
        ),
      );
      const budgetError = results
        .map((result) =>
          result.status === 'rejected' ? result.reason : undefined,
        )
        .find((reason) => isAssetMaterializationBudgetError(reason));
      if (budgetError) throw budgetError;
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      const succeeded = results.length - rejected.length;
      if (rejected.length === 0) {
        toast.success(
          labels.attachSucceededToast.replace('{count}', String(succeeded)),
        );
      } else if (succeeded === 0) {
        const message =
          rejected[0]!.reason instanceof Error
            ? rejected[0]!.reason.message
            : String(rejected[0]!.reason);
        toast.error(labels.materializeFailed.replace('{message}', message));
      } else {
        toast.warning(
          labels.attachPartialToast
            .replace('{succeeded}', String(succeeded))
            .replace('{failed}', String(rejected.length)),
        );
      }
    },
    [
      actions,
      labels.attachPartialToast,
      labels.attachSucceededToast,
      labels.materializeFailed,
      materializeSessionId,
    ],
  );

  const scheduleActiveAssetClear = useCallback(() => {
    activeAssetClearTimerRef.current = window.setTimeout(() => {
      setActiveAssetIds([]);
      activeAssetClearTimerRef.current = null;
    }, ASSET_MATERIALIZATION_NOTICE_TTL_MS);
  }, []);

  const handleBudgetIncreaseRetry = useCallback(async () => {
    if (!budgetIssue) return;
    const assetIds = pendingBudgetAssetIdsRef.current;
    if (assetIds.length === 0) return;
    if (activeAssetClearTimerRef.current) {
      window.clearTimeout(activeAssetClearTimerRef.current);
      activeAssetClearTimerRef.current = null;
    }
    setBudgetIncreasing(true);
    setAttaching(true);
    try {
      await applyAssetMaterializationBudgetIncrease(budgetIssue.detail);
      setBudgetIssue(null);
      setActiveAssetIds(assetIds);
      await attachCatalogAssetIds(assetIds);
    } catch (error) {
      if (isAssetMaterializationBudgetError(error)) {
        setBudgetIssue(error);
      } else {
        showAttachError(error);
      }
    } finally {
      setBudgetIncreasing(false);
      setAttaching(false);
      scheduleActiveAssetClear();
    }
  }, [
    attachCatalogAssetIds,
    budgetIssue,
    scheduleActiveAssetClear,
    showAttachError,
  ]);

  const attachCatalogSelection = useCallback(
    (assetIds: string[]) => {
      if (activeAssetClearTimerRef.current) {
        window.clearTimeout(activeAssetClearTimerRef.current);
        activeAssetClearTimerRef.current = null;
      }
      setAttaching(true);
      setBudgetIssue(null);
      setActiveAssetIds(assetIds);
      pendingBudgetAssetIdsRef.current = assetIds;
      toast.info(
        labels.attachQueuedToast.replace('{count}', String(assetIds.length)),
      );
      void (async () => {
        try {
          await attachCatalogAssetIds(assetIds);
        } catch (error) {
          if (isAssetMaterializationBudgetError(error)) {
            setBudgetIssue(error);
          } else {
            showAttachError(error);
          }
        } finally {
          setAttaching(false);
          scheduleActiveAssetClear();
        }
      })();
    },
    [
      labels.attachQueuedToast,
      attachCatalogAssetIds,
      scheduleActiveAssetClear,
      showAttachError,
    ],
  );

  const handleCatalogAssetDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const payload = readAssetDragPayload(event.dataTransfer);
      if (!payload) return;
      event.preventDefault();
      attachCatalogSelection(payload.assetIds);
    },
    [attachCatalogSelection],
  );

  return {
    attaching,
    budgetIssue,
    setBudgetIssue,
    budgetIncreasing,
    materializationState,
    showAttachError,
    attachCatalogSelection,
    handleCatalogAssetDrop,
    handleBudgetIncreaseRetry,
  };
}
