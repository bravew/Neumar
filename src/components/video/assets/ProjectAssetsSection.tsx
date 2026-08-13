import {
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { toast } from 'sonner';

import { AssetMaterializationNotice } from '@/components/assets/AssetMaterializationNotice';
import {
  ASSET_DRAG_MIME,
  applyAssetMaterializationBudgetIncrease,
  isAssetMaterializationBudgetError,
  readAssetDragPayload,
} from '@/shared/assets';
import type { AssetMaterializationBudgetError } from '@/shared/assets';
import {
  ASSET_MATERIALIZATION_NOTICE_TTL_MS,
  useAssetMaterializationEvents,
  useLatestMaterializationState,
} from '@/shared/hooks/useAssetMaterializationEvents';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { ProjectAssetsDialogs } from './ProjectAssetsDialogs';
import { ProjectAssetsEmptyState } from './ProjectAssetsEmptyState';
import {
  dedupeProjectAssets,
  ProjectAssetsGroupedList,
} from './ProjectAssetsGroupedList';
import { ProjectAssetsHeader } from './ProjectAssetsHeader';
import { useAddLocalFiles } from './useAddLocalFiles';
import { useAddLocalFolder } from './useAddLocalFolder';
import { useNewAssetTracker } from './useNewAssetTracker';
import { useProjectAssetDeletion } from './useProjectAssetDeletion';
import { useProjectAssetMaterializationActions } from './useProjectAssetMaterializationActions';
import { useProjectAssetTimelineActions } from './useProjectAssetTimelineActions';

type ProjectAsset = VideoProject['assets'][number];

interface ProjectAssetsSectionProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  selectedContextAssetIds?: string[];
  onToggleAssetContext?: (asset: ProjectAsset) => void;
}

export function ProjectAssetsSection({
  project,
  actions,
  selectedContextAssetIds,
  onToggleAssetContext,
}: ProjectAssetsSectionProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail;
  const assetLabels = t.assets;

  const [previewAsset, setPreviewAsset] = useState<ProjectAsset | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [budgetIssue, setBudgetIssue] =
    useState<AssetMaterializationBudgetError | null>(null);
  const [budgetIncreasing, setBudgetIncreasing] = useState(false);
  const [activeAssetIds, setActiveAssetIds] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [contextOnly, setContextOnly] = useState(false);
  const { addingFolder, addLocalFolder } = useAddLocalFolder(
    actions,
    labels.addFolder,
  );
  const { fileInputRef, addingFiles, openFilePicker, handleFilesSelected } =
    useAddLocalFiles(actions, assetLabels);
  // Stable per-project session id: the assets panel and the timeline both
  // subscribe to materialization events, and a shared id lets them share one
  // SSE connection (see shared-event-source) instead of opening two.
  const materializeSessionId = `video-materialize-${project.id}`;
  const pendingBudgetAssetIdsRef = useRef<string[]>([]);
  const activeAssetClearTimerRef = useRef<number | null>(null);
  const materializationStates =
    useAssetMaterializationEvents(materializeSessionId);
  const materializationState = useLatestMaterializationState(
    materializationStates,
    activeAssetIds,
  );

  const newIds = useNewAssetTracker(project.assets);
  const uniqueProjectAssetCount = dedupeProjectAssets(project.assets).length;

  const newCount = newIds.size;
  const contextCount = selectedContextAssetIds?.length ?? 0;
  // Don't let a stale "context only" filter empty the list once every context
  // asset has been removed — the chip is hidden in that case anyway.
  const effectiveContextOnly = contextOnly && contextCount > 0;

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
      toast.error(assetLabels.materializeFailed.replace('{message}', message));
    },
    [assetLabels.materializeFailed],
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
          assetLabels.attachSucceededToast.replace(
            '{count}',
            String(succeeded),
          ),
        );
      } else if (succeeded === 0) {
        const message =
          rejected[0]!.reason instanceof Error
            ? rejected[0]!.reason.message
            : String(rejected[0]!.reason);
        toast.error(
          assetLabels.materializeFailed.replace('{message}', message),
        );
      } else {
        toast.warning(
          assetLabels.attachPartialToast
            .replace('{succeeded}', String(succeeded))
            .replace('{failed}', String(rejected.length)),
        );
      }
    },
    [
      actions,
      assetLabels.attachPartialToast,
      assetLabels.attachSucceededToast,
      assetLabels.materializeFailed,
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
        assetLabels.attachQueuedToast.replace(
          '{count}',
          String(assetIds.length),
        ),
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
      assetLabels.attachQueuedToast,
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

  const materializationActions = useProjectAssetMaterializationActions({
    actions,
    sessionId: materializeSessionId,
    onBudgetIssue: setBudgetIssue,
    onError: showAttachError,
  });
  const timelineAssetActions = useProjectAssetTimelineActions({
    project,
    actions,
    sessionId: materializeSessionId,
    onBudgetIssue: setBudgetIssue,
    onError: showAttachError,
  });
  const assetDeletion = useProjectAssetDeletion({ project, actions });

  return (
    <section
      className="space-y-2"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleCatalogAssetDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,image/*,audio/*"
        className="hidden"
        onChange={(event) => void handleFilesSelected(event)}
      />

      <ProjectAssetsHeader
        labels={labels}
        browseCatalogLabel={assetLabels.browseCatalog}
        newCount={newCount}
        uniqueProjectAssetCount={uniqueProjectAssetCount}
        contextCount={contextCount}
        contextOnly={effectiveContextOnly}
        addingFolder={addingFolder}
        addingFiles={addingFiles}
        onOpenBrowser={() => setBrowserOpen(true)}
        onOpenCatalog={() => setCatalogOpen(true)}
        onAddLocalFolder={() => void addLocalFolder()}
        onAddLocalFiles={openFilePicker}
        onConnectCloud={() => setCloudOpen(true)}
        onToggleContextOnly={() => setContextOnly((value) => !value)}
      />

      <AssetMaterializationNotice
        attaching={attaching}
        attachError={null}
        budgetIncreasing={budgetIncreasing}
        budgetIssue={budgetIssue}
        className="rounded-md px-2 py-1.5 text-[11px]"
        labels={assetLabels}
        onBudgetRetry={() => void handleBudgetIncreaseRetry()}
        state={materializationState}
      />

      {uniqueProjectAssetCount === 0 ? (
        <ProjectAssetsEmptyState
          addingFolder={addingFolder}
          addingFiles={addingFiles}
          onAddLocalFiles={openFilePicker}
          onAddLocalFolder={() => void addLocalFolder()}
          onConnectCloud={() => setCloudOpen(true)}
          onOpenCatalog={() => setCatalogOpen(true)}
        />
      ) : (
        <ProjectAssetsGroupedList
          project={project}
          newIds={newIds}
          materializationStates={materializationStates}
          materializationActions={materializationActions}
          selectedContextAssetIds={selectedContextAssetIds}
          contextOnly={effectiveContextOnly}
          onPreview={(asset) => setPreviewAsset(asset)}
          onPlace={timelineAssetActions.placeAsset}
          onDownload={timelineAssetActions.downloadAsset}
          onDelete={assetDeletion.requestDelete}
          onToggleContext={onToggleAssetContext}
        />
      )}

      <ProjectAssetsDialogs
        project={project}
        actions={actions}
        previewAsset={previewAsset}
        browserOpen={browserOpen}
        catalogOpen={catalogOpen}
        cloudOpen={cloudOpen}
        newIds={newIds}
        selectedContextAssetIds={selectedContextAssetIds}
        onPreviewChange={setPreviewAsset}
        onBrowserOpenChange={setBrowserOpen}
        onCatalogOpenChange={setCatalogOpen}
        onCloudOpenChange={setCloudOpen}
        onPlace={timelineAssetActions.placeAsset}
        onDownload={timelineAssetActions.downloadAsset}
        onDelete={assetDeletion.requestDelete}
        onToggleContext={onToggleAssetContext}
        onAttachCatalog={attachCatalogSelection}
      />

      {assetDeletion.dialog}
    </section>
  );
}
