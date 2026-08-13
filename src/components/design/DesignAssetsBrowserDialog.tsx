import { useMemo, useState } from 'react';

import { FileAudio, FileText, Image, Video } from 'lucide-react';

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
import { designBlobUrl } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignOutput } from '@/shared/types/design-mode';

const FILTER_ORDER = ['all', 'image', 'video', 'audio', 'document'] as const;

type FilterKind = (typeof FILTER_ORDER)[number];

interface DesignAssetsBrowserDialogProps {
  open: boolean;
  projectId: string;
  assets: DesignOutput[];
  onOpenChange: (open: boolean) => void;
  onOpenAsset: (asset: DesignOutput) => void;
}

export function DesignAssetsBrowserDialog({
  open,
  projectId,
  assets,
  onOpenChange,
  onOpenAsset,
}: DesignAssetsBrowserDialogProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FilterKind>('all');
  const [viewMode, setViewMode] =
    useState<CreativeAssetBrowserViewMode>('grid');
  const counts = useMemo(() => countByKind(assets), [assets]);
  const visible = useMemo(
    () =>
      assets.filter((asset) => {
        const matchesKind = kind === 'all' || asset.kind === kind;
        const needle = query.trim().toLowerCase();
        const matchesQuery =
          !needle ||
          asset.path.toLowerCase().includes(needle) ||
          (asset.provider ?? '').toLowerCase().includes(needle) ||
          (asset.model ?? '').toLowerCase().includes(needle);
        return matchesKind && matchesQuery;
      }),
    [assets, kind, query],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-5xl grid-rows-none flex-col gap-4 p-5">
        <DialogHeader>
          <DialogTitle>{t.design.browseGeneratedAssets}</DialogTitle>
          <DialogDescription>
            {t.design.generatedAssetsBrowserDescription}
          </DialogDescription>
        </DialogHeader>

        <CreativeAssetBrowser
          query={query}
          onQueryChange={setQuery}
          queryPlaceholder={t.design.generatedAssetsSearchPlaceholder}
          empty={visible.length === 0}
          emptyMessage={t.design.noMatchingGeneratedAssets}
          kindFilters={FILTER_ORDER.map((entry) => ({
            id: entry,
            label: filterLabel(entry, t),
            count: entry === 'all' ? assets.length : counts[entry],
          }))}
          activeKind={kind}
          onKindChange={(entry) => setKind(entry as FilterKind)}
          viewMode={viewMode}
          viewModes={['grid', 'list']}
          onViewModeChange={setViewMode}
          totalCount={visible.length}
        >
          <div
            className={
              viewMode === 'list'
                ? 'grid grid-cols-1 gap-3'
                : 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3'
            }
          >
            {visible.map((asset) => (
              <DesignAssetBrowserCard
                key={asset.id}
                projectId={projectId}
                asset={asset}
                onOpen={() => onOpenAsset(asset)}
              />
            ))}
          </div>
        </CreativeAssetBrowser>
      </DialogContent>
    </Dialog>
  );
}

function DesignAssetBrowserCard({
  projectId,
  asset,
  onOpen,
}: {
  projectId: string;
  asset: DesignOutput;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const Icon = iconForKind(asset.kind);
  const src = designBlobUrl(projectId, asset.path);
  const previewUrl = isVisualAsset(asset) ? src : '';
  return (
    <AssetHoverPreview
      title={asset.path}
      subtitle={`${asset.provider ?? t.design.providerLocal} · ${
        asset.model ?? t.design.modelAuto
      }`}
      kind={asset.kind}
      previewUrl={previewUrl}
      previewKind={asset.kind === 'video' ? 'video' : 'image'}
      rows={designAssetDetailRows(asset, t)}
    >
      <article className="border-border bg-card rounded-md border p-2">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${t.assets.openPreview}: ${asset.path}`}
          title={`${t.assets.openPreview}: ${asset.path}`}
          className="bg-muted text-muted-foreground relative flex aspect-video w-full items-center justify-center overflow-hidden rounded"
        >
          <Icon className="size-6" />
          {isVisualAsset(asset) ? (
            asset.kind === 'video' ? (
              <video
                src={src}
                className="absolute inset-0 size-full object-cover"
                muted
              />
            ) : (
              <img
                src={src}
                alt=""
                className="absolute inset-0 size-full object-cover"
                loading="lazy"
              />
            )
          ) : null}
        </button>
        <p className="text-foreground mt-2 truncate text-xs font-medium">
          {asset.path}
        </p>
        <p className="text-muted-foreground truncate text-[11px]">
          {asset.provider ?? t.design.providerLocal} ·{' '}
          {asset.model ?? t.design.modelAuto}
        </p>
      </article>
    </AssetHoverPreview>
  );
}

function countByKind(assets: DesignOutput[]): Record<FilterKind, number> {
  return {
    all: assets.length,
    image: assets.filter((asset) => asset.kind === 'image').length,
    video: assets.filter((asset) => asset.kind === 'video').length,
    audio: assets.filter((asset) => asset.kind === 'audio').length,
    document: assets.filter((asset) => asset.kind === 'document').length,
  };
}

function isVisualAsset(asset: DesignOutput): boolean {
  return asset.kind === 'image' || asset.kind === 'video';
}

function iconForKind(kind: string) {
  if (kind === 'image') return Image;
  if (kind === 'video') return Video;
  if (kind === 'audio') return FileAudio;
  return FileText;
}

function designAssetDetailRows(
  asset: DesignOutput,
  t: ReturnType<typeof useLanguage>['t'],
): Array<[string, string]> {
  return [
    [t.assets.kind, designAssetKindLabel(asset.kind, t)],
    [t.assets.mime, asset.mime ?? ''],
    [t.design.assetProvider, asset.provider ?? t.design.providerLocal],
    [t.design.assetModel, asset.model ?? t.design.modelAuto],
    [t.design.createdAt, formatCreatedAt(asset.createdAt)],
    [t.design.assetPath, asset.path],
  ];
}

function designAssetKindLabel(
  kind: string,
  t: ReturnType<typeof useLanguage>['t'],
): string {
  if (kind === 'image') return t.assets.kindImage;
  if (kind === 'video') return t.assets.kindVideo;
  if (kind === 'audio') return t.assets.kindAudio;
  if (kind === 'document') return t.assets.kindDoc;
  return kind;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function filterLabel(
  kind: FilterKind,
  t: ReturnType<typeof useLanguage>['t'],
): string {
  if (kind === 'all') return t.assets.allKinds;
  if (kind === 'image') return t.assets.kindImage;
  if (kind === 'video') return t.assets.kindVideo;
  if (kind === 'audio') return t.assets.kindAudio;
  return t.assets.kindDoc;
}
