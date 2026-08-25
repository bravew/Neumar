import { useState } from 'react';

import { AssetMaterializationNotice } from '@/components/assets/AssetMaterializationNotice';
import { ASSET_DRAG_MIME } from '@/shared/assets';
import { useAssetMaterializationEvents } from '@/shared/hooks/useAssetMaterializationEvents';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { AssetBatchProgressPanel } from './AssetBatchProgressPanel';
import { ProjectAssetsDialogs } from './ProjectAssetsDialogs';
import { ProjectAssetsEmptyState } from './ProjectAssetsEmptyState';
import {
  dedupeProjectAssets,
  ProjectAssetsGroupedList,
} from './ProjectAssetsGroupedList';
import { ProjectAssetsHeader } from './ProjectAssetsHeader';
import { useAddLocalFiles } from './useAddLocalFiles';
import { useAddLocalFolder } from './useAddLocalFolder';
import { useCatalogAssetAttach } from './useCatalogAssetAttach';
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
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [contextOnly, setContextOnly] = useState(false);
  // Stable per-project session id: the assets panel and the timeline both
  // subscribe to materialization events, and a shared id lets them share one
  // SSE connection (see shared-event-source) instead of opening two. Also
  // threaded into the add-folder/add-files hooks so proxy generation for
  // freshly attached assets reports through the same live progress feed.
  const materializeSessionId = `video-materialize-${project.id}`;
  const {
    addingFolder,
    addLocalFolder,
    progress: folderProgress,
  } = useAddLocalFolder(
    actions,
    labels.addFolder,
    { ...assetLabels, ...labels.batchProgress },
    materializeSessionId,
  );
  const { fileInputRef, addingFiles, openFilePicker, handleFilesSelected } =
    useAddLocalFiles(actions, assetLabels, materializeSessionId);
  const materializationStates =
    useAssetMaterializationEvents(materializeSessionId);

  const newIds = useNewAssetTracker(project.assets);
  const uniqueProjectAssetCount = dedupeProjectAssets(project.assets).length;

  const newCount = newIds.size;
  const contextCount = selectedContextAssetIds?.length ?? 0;
  // Don't let a stale "context only" filter empty the list once every context
  // asset has been removed — the chip is hidden in that case anyway.
  const effectiveContextOnly = contextOnly && contextCount > 0;

  const {
    attaching,
    budgetIssue,
    setBudgetIssue,
    budgetIncreasing,
    materializationState,
    showAttachError,
    attachCatalogSelection,
    handleCatalogAssetDrop,
    handleBudgetIncreaseRetry,
  } = useCatalogAssetAttach({
    actions,
    labels: assetLabels,
    materializeSessionId,
    materializationStates,
  });

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
          onProjectUpdated={actions.onProjectUpdated}
          newIds={newIds}
          materializationStates={materializationStates}
          materializationActions={materializationActions}
          selectedContextAssetIds={selectedContextAssetIds}
          contextOnly={effectiveContextOnly}
          onPreview={(asset) => setPreviewAsset(asset)}
          onPlace={timelineAssetActions.placeAsset}
          onPlaceMany={timelineAssetActions.placeAssets}
          onDownload={timelineAssetActions.downloadAsset}
          onDelete={assetDeletion.requestDelete}
          onDeleteMany={assetDeletion.requestDeleteMany}
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

      <AssetBatchProgressPanel
        assets={project.assets}
        states={materializationStates}
        actions={materializationActions}
        localTask={folderProgress}
      />
    </section>
  );
}
