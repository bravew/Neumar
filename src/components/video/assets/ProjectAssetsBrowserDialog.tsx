import { useMemo, useState } from 'react';

import { FileAudio, FileVideo, Image as ImageIcon } from 'lucide-react';

import { AssetHoverPreview } from '@/components/assets/AssetHoverPreview';
import {
  CreativeAssetBrowser,
  type CreativeAssetBrowserViewMode,
} from '@/components/creative/CreativeAssetBrowser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { writeProjectAssetDrag } from '../projectAssetDrag';
import { ProjectAssetActionGroup } from './ProjectAssetActionGroup';
import {
  dedupeProjectAssets,
  useProjectAssetFilter,
  useProjectAssetGroups,
} from './ProjectAssetsGroupedList';
import {
  positiveDurationMs,
  projectAssetDetailRows,
  projectAssetDisplayName,
  projectAssetDisplaySubtitle,
  projectAssetMetaSummary,
  projectAssetPreviewMedia,
  projectAssetSourceLink,
  projectAssetThumbnailUrl,
} from './ProjectAssetTile';
import { canDownloadProjectAsset } from './useProjectAssetTimelineActions';

type ProjectAsset = VideoProject['assets'][number];
type AssetLabels = ReturnType<typeof useLanguage>['t']['assets'];
type Kind = ProjectAsset['kind'];
type FilterKind = Kind | 'all';

const FILTER_ORDER: FilterKind[] = ['all', 'video', 'image', 'audio'];

const KIND_ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
} as const;

interface ProjectAssetsBrowserDialogProps {
  open: boolean;
  project: VideoProject;
  newIds: Set<string>;
  selectedContextAssetIds?: string[];
  onOpenChange: (open: boolean) => void;
  onPlace: (asset: ProjectAsset) => void;
  onDownload: (asset: ProjectAsset) => void;
  onDelete: (assetId: string) => void;
  onPreview: (asset: ProjectAsset) => void;
  onToggleContext?: (asset: ProjectAsset) => void;
}

export function ProjectAssetsBrowserDialog({
  open,
  project,
  newIds,
  selectedContextAssetIds = [],
  onOpenChange,
  onPlace,
  onDownload,
  onDelete,
  onPreview,
  onToggleContext,
}: ProjectAssetsBrowserDialogProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail;
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FilterKind>('all');
  const [viewMode, setViewMode] =
    useState<CreativeAssetBrowserViewMode>('grid');
  const uniqueAssets = useMemo(
    () => dedupeProjectAssets(project.assets),
    [project.assets],
  );
  const queried = useProjectAssetFilter(uniqueAssets, query);
  const visible = useMemo(
    () => queried.filter((asset) => kind === 'all' || asset.kind === kind),
    [kind, queried],
  );
  const allGroups = useProjectAssetGroups(uniqueAssets);
  const visibleGroups = useProjectAssetGroups(visible);
  const selectedContextAssetIdSet = useMemo(
    () => new Set(selectedContextAssetIds),
    [selectedContextAssetIds],
  );
  const renderCard = (asset: ProjectAsset) => (
    <AssetBrowserCard
      key={asset.id}
      projectId={project.id}
      asset={asset}
      isNew={newIds.has(asset.id)}
      selectedForContext={selectedContextAssetIdSet.has(asset.id)}
      placeLabel={labels.placeAsset}
      downloadLabel={labels.downloadAsset}
      deleteLabel={labels.deleteAsset}
      previewLabel={t.assets.openPreview}
      addContextLabel={t.video.editor.agentDock.composer.addAssetContext}
      removeContextLabel={t.video.editor.agentDock.composer.removeAssetContext}
      assetLabels={t.assets}
      onPlace={onPlace}
      onDownload={onDownload}
      onDelete={onDelete}
      onPreview={onPreview}
      onToggleContext={onToggleContext}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-5xl grid-rows-none flex-col gap-4 p-5">
        <DialogHeader>
          <DialogTitle>{labels.projectAssets}</DialogTitle>
          <DialogDescription>
            {labels.projectAssetsBrowserDescription}
          </DialogDescription>
        </DialogHeader>

        <CreativeAssetBrowser
          query={query}
          onQueryChange={setQuery}
          queryPlaceholder={labels.projectAssetsSearchPlaceholder}
          empty={visible.length === 0}
          emptyMessage={labels.noMatchingProjectAssets}
          kindFilters={FILTER_ORDER.map((entry) => ({
            id: entry,
            label: filterLabel(entry, labels, t.assets.allKinds),
            count:
              entry === 'all' ? uniqueAssets.length : allGroups[entry].length,
          }))}
          activeKind={kind}
          onKindChange={(entry) => setKind(entry as FilterKind)}
          viewMode={viewMode}
          viewModes={['grid', 'list', 'grouped']}
          onViewModeChange={setViewMode}
          selectedCount={selectedContextAssetIds.length}
          totalCount={visible.length}
        >
          {viewMode === 'grouped' ? (
            <div className="space-y-5">
              {(['video', 'image', 'audio'] as const).map((entry) =>
                visibleGroups[entry].length ? (
                  <section key={entry} className="space-y-2">
                    <h3 className="text-muted-foreground text-xs font-medium">
                      {filterLabel(entry, labels, t.assets.allKinds)}
                      <span className="ml-1 tabular-nums">
                        {visibleGroups[entry].length}
                      </span>
                    </h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                      {visibleGroups[entry].map(renderCard)}
                    </div>
                  </section>
                ) : null,
              )}
            </div>
          ) : (
            <div
              className={
                viewMode === 'list'
                  ? 'grid grid-cols-1 gap-3'
                  : 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3'
              }
            >
              {visible.map(renderCard)}
            </div>
          )}
        </CreativeAssetBrowser>
      </DialogContent>
    </Dialog>
  );
}

function AssetBrowserCard({
  projectId,
  asset,
  isNew,
  selectedForContext,
  placeLabel,
  downloadLabel,
  deleteLabel,
  previewLabel,
  addContextLabel,
  removeContextLabel,
  assetLabels,
  onPlace,
  onDownload,
  onDelete,
  onPreview,
  onToggleContext,
}: {
  projectId: string;
  asset: ProjectAsset;
  isNew: boolean;
  selectedForContext: boolean;
  placeLabel: string;
  downloadLabel: string;
  deleteLabel: string;
  previewLabel: string;
  addContextLabel: string;
  removeContextLabel: string;
  assetLabels: AssetLabels;
  onPlace: (asset: ProjectAsset) => void;
  onDownload: (asset: ProjectAsset) => void;
  onDelete: (assetId: string) => void;
  onPreview: (asset: ProjectAsset) => void;
  onToggleContext?: (asset: ProjectAsset) => void;
}) {
  const filename = projectAssetDisplayName(asset);
  const contextLabel = selectedForContext
    ? removeContextLabel.replace('{name}', filename)
    : addContextLabel.replace('{name}', filename);
  const Icon = KIND_ICONS[asset.kind] ?? ImageIcon;
  const draggable =
    asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio';
  const thumbUrl = projectAssetThumbnailUrl(projectId, asset);
  const metaSummary = projectAssetMetaSummary(asset);
  const preview = projectAssetPreviewMedia(projectId, asset);
  return (
    <AssetHoverPreview
      title={filename}
      subtitle={projectAssetDisplaySubtitle(asset)}
      kind={asset.kind}
      previewUrl={preview.url ?? thumbUrl}
      previewKind={preview.kind}
      previewPoster={preview.poster}
      rows={projectAssetDetailRows(asset, assetLabels)}
      sourceLink={projectAssetSourceLink(asset, assetLabels)}
    >
      <article
        className={cn(
          'border-border bg-card group relative rounded-md border p-2',
          draggable && 'cursor-grab active:cursor-grabbing',
          isNew && 'ring-primary ring-offset-background ring-2 ring-offset-1',
          selectedForContext &&
            'border-primary bg-primary/10 ring-primary/20 ring-1',
        )}
        draggable={draggable}
        onDragStart={(event) => {
          if (!draggable) return;
          writeProjectAssetDrag(event.dataTransfer, {
            assetId: asset.id,
            kind: asset.kind,
            name: filename,
            durationMs: positiveDurationMs(asset) ?? undefined,
          });
        }}
        onDoubleClick={() => onPreview(asset)}
        title={projectAssetDisplaySubtitle(asset)}
      >
        <button
          type="button"
          className="bg-muted text-muted-foreground relative flex aspect-video w-full items-center justify-center overflow-hidden rounded"
          aria-label={`${previewLabel}: ${filename}`}
          title={`${previewLabel}: ${filename}`}
          onClick={() => onPreview(asset)}
        >
          <Icon className="size-6" />
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
        </button>
        <div className="mt-2 flex items-start gap-2">
          {onToggleContext ? (
            <input
              type="checkbox"
              checked={selectedForContext}
              aria-label={contextLabel}
              title={contextLabel}
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggleContext(asset)}
              className="accent-primary mt-0.5 size-3.5 shrink-0"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-xs font-medium">
              {filename}
            </p>
            {metaSummary ? (
              <p className="text-muted-foreground truncate text-[11px]">
                {metaSummary}
              </p>
            ) : null}
          </div>
          <ProjectAssetActionGroup
            placeLabel={placeLabel}
            downloadLabel={downloadLabel}
            deleteLabel={deleteLabel}
            assetName={filename}
            canDownload={canDownloadProjectAsset(asset)}
            onPlace={() => onPlace(asset)}
            onDownload={() => onDownload(asset)}
            onDelete={() => onDelete(asset.id)}
          />
        </div>
      </article>
    </AssetHoverPreview>
  );
}

function filterLabel(
  kind: FilterKind,
  labels: {
    kindVideo: string;
    kindImage: string;
    kindAudio: string;
  },
  allLabel: string,
): string {
  if (kind === 'all') return allLabel;
  if (kind === 'video') return labels.kindVideo;
  if (kind === 'image') return labels.kindImage;
  return labels.kindAudio;
}
