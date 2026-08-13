import { memo, useEffect, useState } from 'react';

import {
  Check,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  HardDrive,
  Sparkles,
} from 'lucide-react';

import { AssetHoverPreview } from '@/components/assets/AssetHoverPreview';
import { CloudProviderIcon } from '@/components/library/CloudProviderIcon';
import { resolveAssetThumbUrl } from '@/shared/assets/api';
import { writeAssetDragPayload } from '@/shared/assets/dragPayload';
import type { Asset, AssetSource } from '@/shared/assets/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export interface AssetTileProps {
  asset: Asset;
  index: number;
  selected: boolean;
  /**
   * Lazily read the current selection at drag time. Passed as a stable
   * accessor (not the live array) so React.memo can skip re-rendering tiles
   * whose `selected` state did not change.
   */
  getSelectedIds: () => string[];
  onOpen: (asset: Asset) => void;
  onToggleSelected: (id: string) => void;
}

export const AssetTile = memo(function AssetTile({
  asset,
  index,
  selected,
  getSelectedIds,
  onOpen,
  onToggleSelected,
}: AssetTileProps) {
  const { t } = useLanguage();
  const s = t.assets;
  const name = asset.title || asset.storagePath || asset.id;
  const thumb = resolveAssetThumbUrl(asset);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbUrl = thumbFailed ? null : thumb;
  const metaSummary = assetMetaSummary(asset);

  useEffect(() => {
    setThumbFailed(false);
  }, [thumb]);

  return (
    <AssetHoverPreview
      title={name}
      subtitle={asset.storagePath ?? asset.mime}
      kind={asset.kind}
      previewUrl={thumbUrl}
      rows={assetDetailRows(asset, s)}
    >
      <article
        draggable
        onDragStart={(event) => {
          const ids = selected ? getSelectedIds() : [asset.id];
          writeAssetDragPayload(event.dataTransfer, {
            assetIds: ids,
            primaryKind: asset.kind,
            source: 'library',
          });
        }}
        className={cn(
          'bg-card border-border group overflow-hidden rounded-md border',
          selected && 'border-primary ring-primary/30 ring-2',
        )}
      >
        <button
          type="button"
          data-asset-tile
          data-asset-index={index}
          aria-pressed={selected}
          aria-label={`${s.openPreview}: ${name}`}
          onClick={() => onOpen(asset)}
          onKeyDown={(event) =>
            handleTileKeyDown(
              event,
              index,
              asset.id,
              onOpen,
              onToggleSelected,
              asset,
            )
          }
          className="bg-muted focus-visible:ring-ring relative block aspect-square w-full overflow-hidden outline-none focus-visible:ring-2"
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={s.thumbAlt.replace('{name}', name)}
              className="size-full object-cover transition-transform group-hover:scale-[1.02]"
              decoding="async"
              loading="lazy"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <span className="text-muted-foreground flex size-full items-center justify-center">
              <AssetIcon asset={asset} />
            </span>
          )}
          {asset.kind === 'video' ? (
            <span className="absolute right-2 bottom-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {s.kindVideo}
            </span>
          ) : null}
          <SourceBadge
            source={asset.source}
            label={sourceLabel(asset.source, s)}
          />
        </button>

        <div className="flex items-start gap-2 p-2">
          <button
            type="button"
            aria-label={`${s.selectAsset}: ${name}`}
            aria-pressed={selected}
            onClick={() => onToggleSelected(asset.id)}
            className={cn(
              'border-border mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
              selected && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            {selected ? <Check className="size-3" aria-hidden /> : null}
          </button>
          <div className="min-w-0">
            <p className="text-foreground line-clamp-2 text-xs font-medium">
              {name}
            </p>
            <p className="text-muted-foreground mt-1 text-[11px]">
              {assetKindLabel(asset.kind, s)}
              {metaSummary ? ` · ${metaSummary}` : ''}
            </p>
          </div>
        </div>
      </article>
    </AssetHoverPreview>
  );
});

function handleTileKeyDown(
  event: React.KeyboardEvent<HTMLButtonElement>,
  index: number,
  assetId: string,
  onOpen: (asset: Asset) => void,
  onToggleSelected: (id: string) => void,
  asset: Asset,
): void {
  if (event.key === ' ') {
    event.preventDefault();
    onToggleSelected(assetId);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    onOpen(asset);
    return;
  }
  const columns = Math.max(
    1,
    Math.floor(
      (event.currentTarget.closest('[data-asset-grid]')?.clientWidth ?? 1) /
        162,
    ),
  );
  const next =
    event.key === 'ArrowRight'
      ? index + 1
      : event.key === 'ArrowLeft'
        ? index - 1
        : event.key === 'ArrowDown'
          ? index + columns
          : event.key === 'ArrowUp'
            ? index - columns
            : index;
  if (next !== index) {
    event.preventDefault();
    focusTile(next);
  }
}

function focusTile(index: number): void {
  const target = document.querySelector<HTMLButtonElement>(
    `[data-asset-tile][data-asset-index="${index}"]`,
  );
  target?.focus();
}

// Small provenance chip pinned to the top-left of the thumbnail so the user
// can tell at a glance which connector an asset came from when "All sources"
// is selected. Uses the brand icon (Box/Drive/Immich/…) when available and
// neutral lucide glyphs for local/AI-generated rows. The semi-translucent
// white pill keeps the brand mark readable against any thumbnail.
function SourceBadge({
  source,
  label,
}: {
  source: AssetSource;
  label: string;
}) {
  return (
    <span
      className="bg-background/85 ring-border/40 absolute top-2 left-2 inline-flex size-6 items-center justify-center rounded-md shadow-sm ring-1 backdrop-blur-sm"
      title={label}
      aria-label={label}
    >
      <SourceBadgeIcon source={source} />
    </span>
  );
}

function SourceBadgeIcon({ source }: { source: AssetSource }) {
  if (source === 'local_fs') {
    return <HardDrive className="text-foreground/80 size-3.5" aria-hidden />;
  }
  if (source === 'ai_gen') {
    return <Sparkles className="text-foreground/80 size-3.5" aria-hidden />;
  }
  return <CloudProviderIcon provider={source} className="size-3.5" />;
}

function sourceLabel(source: AssetSource, s: Record<string, string>): string {
  const labels: Record<AssetSource, string> = {
    local_fs: s.sourceLocalFs,
    ai_gen: s.sourceAiGen,
    immich: s.sourceImmich,
    photoprism: s.sourcePhotoprism,
    google_drive: s.sourceGoogleDrive,
    dropbox: s.sourceDropbox,
    box: s.sourceBox,
    onedrive: s.sourceOnedrive,
    s3_compatible: s.sourceS3,
    openverse: s.sourceOpenverse,
    unsplash: s.sourceUnsplash,
    pexels: s.sourcePexels,
    pixabay: s.sourcePixabay,
    coverr: s.sourceCoverr,
    videvo: s.sourceVidevo,
  };
  return labels[source] ?? source;
}

function assetMetaSummary(asset: Asset): string {
  const dimensions = assetDimensions(asset);
  const size = formatBytes(asset.bytes);
  if (asset.kind === 'image')
    return [dimensions, size].filter(Boolean).join(' · ');

  const duration = positiveDurationMs(asset);
  const durationText = duration ? formatDuration(duration) : '';
  return [durationText, dimensions, size].filter(Boolean).join(' · ');
}

function assetDetailRows(
  asset: Asset,
  s: Record<string, string>,
): Array<[string, string]> {
  const duration = positiveDurationMs(asset);
  return [
    [s.kind, assetKindLabel(asset.kind, s)],
    [s.source, sourceLabel(asset.source, s)],
    [s.mime, asset.mime],
    [s.bytes, formatBytes(asset.bytes)],
    [s.dimensions, assetDimensions(asset)],
    [s.duration, duration ? formatDuration(duration) : ''],
    [s.captured, formatDate(asset.capturedAt)],
    [s.imported, formatDate(asset.importedAt)],
    [s.modified, formatDate(asset.modifiedAt)],
  ];
}

function assetKindLabel(
  kind: Asset['kind'],
  s: Record<string, string>,
): string {
  const labels: Record<Asset['kind'], string> = {
    image: s.kindImage,
    video: s.kindVideo,
    audio: s.kindAudio,
    pdf: s.kindPdf,
    text: s.kindText,
    doc: s.kindDoc,
    other: s.kindOther,
  };
  return labels[kind] ?? kind;
}

function AssetIcon({ asset }: { asset: Asset }) {
  const className = 'size-9';
  if (asset.kind === 'image')
    return <FileImage className={className} aria-hidden />;
  if (asset.kind === 'video')
    return <FileVideo className={className} aria-hidden />;
  if (asset.kind === 'audio')
    return <FileAudio className={className} aria-hidden />;
  if (asset.kind === 'pdf' || asset.kind === 'text' || asset.kind === 'doc') {
    return <FileText className={className} aria-hidden />;
  }
  return <File className={className} aria-hidden />;
}

function assetDimensions(asset: Asset): string {
  return asset.width && asset.height ? `${asset.width}x${asset.height}` : '';
}

function positiveDurationMs(asset: Asset): number | null {
  return typeof asset.durationMs === 'number' && asset.durationMs > 0
    ? asset.durationMs
    : null;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}
