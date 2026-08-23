import { type ReactNode, useEffect, useRef, useState } from 'react';

import { FileAudio, FileVideo, Image as ImageIcon } from 'lucide-react';

import { AssetHoverPreview } from '@/components/assets/AssetHoverPreview';
import { CloudProviderIcon } from '@/components/library/CloudProviderIcon';
import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { writeProjectAssetDrag } from '../projectAssetDrag';
import { ProjectAssetActionGroup } from './ProjectAssetActionGroup';
import {
  projectAssetMaterializationBadge,
  type ProjectAssetBadgeActions,
} from './projectAssetMaterializationBadge';
import {
  positiveDurationMs,
  projectAssetDetailRows,
  projectAssetDisplayName,
  projectAssetDisplaySubtitle,
  projectAssetMetaSummary,
  projectAssetPreviewMedia,
  projectAssetThumbnailUrl,
} from './projectAssetMedia';
import { ProjectAssetOriginBadge } from './ProjectAssetOriginBadge';
import {
  HAS_CLOUD_PROVIDER_ICON,
  prettyProviderName,
  resolveProvider,
  type ProjectAssetLabels,
} from './projectAssetSource';
import { canDownloadProjectAsset } from './useProjectAssetTimelineActions';

export {
  filenameFromPath,
  positiveDurationMs,
  projectAssetDetailRows,
  projectAssetDisplayName,
  projectAssetDisplaySubtitle,
  projectAssetMetaSummary,
  projectAssetPreviewMedia,
  projectAssetRemoteContentUrl,
  projectAssetStreamUrl,
  projectAssetThumbnailUrl,
  referencedCatalogAssetId,
} from './projectAssetMedia';

type ProjectAsset = VideoProject['assets'][number];

interface ProjectAssetTileProps {
  projectId: string;
  asset: ProjectAsset;
  isNew?: boolean;
  materializationStates?: MaterializationStateMap;
  // Forwarded to the materialization badge so the cancel-X and retry
  // affordances can call back into the rail's hydration controls.
  materializationActions?: ProjectAssetBadgeActions;
  variantCount?: number;
  onPreview?: (asset: ProjectAsset) => void;
  onPlace?: (asset: ProjectAsset) => void;
  onDownload?: (asset: ProjectAsset) => void;
  onDelete?: (assetId: string) => void;
  /** Asset ids whose external master could not be found on the last check. */
  offlineAssetIds?: ReadonlySet<string>;
  onConsolidate?: (assetId: string) => void;
  onRelink?: (asset: ProjectAsset) => void;
  selectedForContext?: boolean;
  onToggleContext?: (asset: ProjectAsset) => void;
}

const KIND_ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
} as const;

// Referenced (un-downloaded) catalog assets have no local thumbnail derivative;
// their thumb is proxied through a remote connector. Right after an app restart
// those connectors are still warming up, so the first thumbnail request can
// 404. Retry a few times with backoff so a transient failure doesn't blank the
// tile forever — only fall back to the kind icon once retries are exhausted.
const THUMB_MAX_RETRIES = 4;
const THUMB_RETRY_BASE_MS = 400;

export function ProjectAssetTile({
  projectId,
  asset,
  isNew = false,
  materializationStates,
  materializationActions,
  variantCount = 1,
  onPreview,
  onPlace,
  onDownload,
  onDelete,
  offlineAssetIds,
  onConsolidate,
  onRelink,
  selectedForContext = false,
  onToggleContext,
}: ProjectAssetTileProps) {
  const { t } = useLanguage();
  const filename = projectAssetDisplayName(asset);
  const contextLabel = selectedForContext
    ? t.video.editor.agentDock.composer.removeAssetContext.replace(
        '{name}',
        filename,
      )
    : t.video.editor.agentDock.composer.addAssetContext.replace(
        '{name}',
        filename,
      );
  const isMedia =
    asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio';
  const thumbnailUrl = projectAssetThumbnailUrl(projectId, asset);
  const metaSummary = projectAssetMetaSummary(asset);
  const isExternal = asset.origin === 'external';
  const externalOnline = !offlineAssetIds?.has(asset.id);
  // For videos, hand the tooltip the playable stream + first-frame poster
  // so it loops a real preview instead of a static thumbnail.
  const preview = projectAssetPreviewMedia(projectId, asset);
  const sourceLabels = t.assets;
  const materializeBadge = projectAssetMaterializationBadge(
    asset,
    materializationStates,
    sourceLabels,
    materializationActions,
  );
  const variantLabel = t.video.editor.assetsRail.variantCount.replace(
    '{count}',
    String(variantCount),
  );

  return (
    <AssetHoverPreview
      title={filename}
      subtitle={projectAssetDisplaySubtitle(asset)}
      kind={asset.kind}
      previewUrl={preview.url ?? thumbnailUrl}
      previewKind={preview.kind}
      previewPoster={preview.poster}
      rows={projectAssetDetailRows(asset, sourceLabels)}
      sourceLink={projectAssetSourceLink(asset, sourceLabels)}
    >
      <div
        className={cn(
          'border-border bg-background hover:border-primary/50 group relative flex items-center gap-2 rounded-md border p-1.5',
          isMedia && 'cursor-grab active:cursor-grabbing',
          isNew &&
            'ring-primary ring-offset-background animate-pulse ring-2 ring-offset-1',
          selectedForContext &&
            'border-primary bg-primary/10 ring-primary/20 ring-1',
        )}
        draggable={isMedia}
        onDragStart={(event) => {
          if (!isMedia) return;
          writeProjectAssetDrag(event.dataTransfer, {
            assetId: asset.id,
            kind: asset.kind as 'image' | 'video' | 'audio',
            name: filename,
            durationMs: positiveDurationMs(asset) ?? undefined,
          });
        }}
        onDoubleClick={() => onPreview?.(asset)}
        title={projectAssetDisplaySubtitle(asset)}
      >
        {onToggleContext ? (
          <input
            type="checkbox"
            checked={selectedForContext}
            aria-label={contextLabel}
            title={contextLabel}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleContext(asset)}
            className="accent-primary size-3.5 shrink-0"
          />
        ) : null}
        <Thumbnail
          asset={asset}
          projectId={projectId}
          badge={materializeBadge}
        />
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate text-[11px] font-medium">
            {filename}
          </div>
          {metaSummary ? (
            <div className="text-muted-foreground text-[10px] uppercase">
              {metaSummary}
            </div>
          ) : null}
        </div>
        <ProjectAssetOriginBadge
          origin={asset.origin}
          online={externalOnline}
        />
        {isNew ? (
          <span className="bg-primary text-primary-foreground rounded-sm px-1 text-[9px] font-semibold uppercase">
            New
          </span>
        ) : null}
        {variantCount > 1 ? (
          <span
            className="bg-muted text-muted-foreground rounded-sm px-1 text-[9px] font-semibold tabular-nums"
            title={variantLabel}
            aria-label={variantLabel}
          >
            +{variantCount - 1}
          </span>
        ) : null}
        <ProjectAssetActionGroup
          placeLabel={t.video.editor.assetsRail.placeAsset}
          downloadLabel={t.video.editor.assetsRail.downloadAsset}
          deleteLabel={t.video.editor.assetsRail.deleteAsset}
          assetName={filename}
          canDownload={canDownloadProjectAsset(asset)}
          onPlace={onPlace ? () => onPlace(asset) : undefined}
          onDownload={onDownload ? () => onDownload(asset) : undefined}
          onDelete={onDelete ? () => onDelete(asset.id) : undefined}
          consolidateLabel={t.video.editor.assetsRail.consolidateAsset}
          relinkLabel={t.video.editor.assetsRail.relinkAsset}
          onConsolidate={
            isExternal && onConsolidate
              ? () => onConsolidate(asset.id)
              : undefined
          }
          onRelink={
            isExternal && !externalOnline && onRelink
              ? () => onRelink(asset)
              : undefined
          }
        />
      </div>
    </AssetHoverPreview>
  );
}

function Thumbnail({
  asset,
  projectId,
  badge,
}: {
  asset: ProjectAsset;
  projectId: string;
  badge: ReactNode;
}) {
  const kind =
    asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio'
      ? asset.kind
      : 'image';
  const Icon = KIND_ICONS[kind] ?? ImageIcon;
  const thumbUrl = projectAssetThumbnailUrl(projectId, asset);

  const [attempt, setAttempt] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset retry state whenever the source URL changes (asset swapped into the
  // same tile, or hydration flips the resolved thumbnail URL).
  useEffect(() => {
    setAttempt(0);
    setExhausted(false);
  }, [thumbUrl]);

  // Cancel any pending retry on unmount.
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  if (thumbUrl && !exhausted) {
    // Cache-bust on retries so the browser re-requests a URL that previously
    // 404'd while the API's remote connectors were still warming up.
    const src =
      attempt > 0
        ? `${thumbUrl}${thumbUrl.includes('?') ? '&' : '?'}retry=${attempt}`
        : thumbUrl;
    return (
      <div className="bg-muted text-muted-foreground relative size-10 shrink-0 overflow-hidden rounded">
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="size-4" />
        </div>
        <img
          // Remount on each retry so this onError closure captures the current
          // attempt and the browser reloads the cache-busted src.
          key={src}
          src={src}
          alt=""
          className="relative size-full object-cover"
          loading="lazy"
          onError={() => {
            if (retryTimer.current) clearTimeout(retryTimer.current);
            if (attempt >= THUMB_MAX_RETRIES) {
              setExhausted(true);
              return;
            }
            retryTimer.current = setTimeout(
              () => setAttempt((n) => n + 1),
              THUMB_RETRY_BASE_MS * 2 ** attempt,
            );
          }}
        />
        {badge}
      </div>
    );
  }
  return (
    <div className="bg-muted text-muted-foreground relative flex size-10 shrink-0 items-center justify-center rounded">
      <Icon className="size-4" />
      {badge}
    </div>
  );
}

// Returns the upstream web URL (Immich photo page, Drive item page, …)
// when the catalog attach recorded one — so the inspector can render an
// "Open in <provider>" affordance without re-walking the asset registry.
export function projectAssetSourceLink(
  asset: ProjectAsset,
  labels?: ProjectAssetLabels,
): {
  url: string;
  provider: string;
  label?: string;
  icon?: ReactNode;
} | null {
  const url = asset.provenance?.sourceUrl;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const provider = resolveProvider(asset);
  const prettyName = labels ? prettyProviderName(provider, labels) : provider;
  const hasBrand = HAS_CLOUD_PROVIDER_ICON.has(provider);
  return {
    url,
    provider,
    // Renders as "Open in Google Drive" / "Open in Immich" — the hover
    // preview component prepends the icon and appends an external-link
    // glyph automatically.
    label: `Open in ${prettyName}`,
    ...(hasBrand
      ? {
          icon: <CloudProviderIcon provider={provider} className="size-3.5" />,
        }
      : {}),
  };
}
