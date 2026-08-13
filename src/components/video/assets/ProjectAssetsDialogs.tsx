import { AssetCatalogPickerDialog } from '@/components/assets/AssetCatalogPickerDialog';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { LinkedSourcesDialog } from './LinkedSourcesDialog';
import { ProjectAssetPreviewDialog } from './ProjectAssetPreviewDialog';
import { ProjectAssetsBrowserDialog } from './ProjectAssetsBrowserDialog';

type ProjectAsset = VideoProject['assets'][number];

interface ProjectAssetsDialogsProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  previewAsset: ProjectAsset | null;
  browserOpen: boolean;
  catalogOpen: boolean;
  cloudOpen: boolean;
  newIds: Set<string>;
  selectedContextAssetIds?: string[];
  onPreviewChange: (asset: ProjectAsset | null) => void;
  onBrowserOpenChange: (open: boolean) => void;
  onCatalogOpenChange: (open: boolean) => void;
  onCloudOpenChange: (open: boolean) => void;
  onPlace: (asset: ProjectAsset) => void;
  onDownload: (asset: ProjectAsset) => void;
  onDelete: (assetId: string) => void;
  onToggleContext?: (asset: ProjectAsset) => void;
  onAttachCatalog: (assetIds: string[]) => void;
}

// The Project-assets surface owns four modals (preview, browse, catalog, linked
// sources). Grouping them here keeps ProjectAssetsSection focused on state and
// data flow rather than modal wiring.
export function ProjectAssetsDialogs({
  project,
  actions,
  previewAsset,
  browserOpen,
  catalogOpen,
  cloudOpen,
  newIds,
  selectedContextAssetIds,
  onPreviewChange,
  onBrowserOpenChange,
  onCatalogOpenChange,
  onCloudOpenChange,
  onPlace,
  onDownload,
  onDelete,
  onToggleContext,
  onAttachCatalog,
}: ProjectAssetsDialogsProps) {
  return (
    <>
      <ProjectAssetPreviewDialog
        projectId={project.id}
        asset={previewAsset}
        onOpenChange={(open) => !open && onPreviewChange(null)}
      />
      <ProjectAssetsBrowserDialog
        open={browserOpen}
        project={project}
        newIds={newIds}
        selectedContextAssetIds={selectedContextAssetIds}
        onOpenChange={onBrowserOpenChange}
        onPreview={onPreviewChange}
        onPlace={onPlace}
        onDownload={onDownload}
        onDelete={onDelete}
        onToggleContext={onToggleContext}
      />
      <AssetCatalogPickerDialog
        open={catalogOpen}
        onOpenChange={onCatalogOpenChange}
        onAttach={onAttachCatalog}
      />
      <LinkedSourcesDialog
        open={cloudOpen}
        project={project}
        actions={actions}
        onOpenChange={onCloudOpenChange}
      />
    </>
  );
}
