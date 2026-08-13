import type { DragEvent } from 'react';

import {
  FileAudio,
  FileVideo,
  GripVertical,
  Image as ImageIcon,
  Maximize2,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import {
  filenameFromPath,
  projectAssetStreamUrl,
} from './assets/ProjectAssetTile';
import { writeProjectAssetDrag } from './projectAssetDrag';

type ProjectAsset = VideoProject['assets'][number];

const KIND_ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
} as const;

/**
 * A draggable inline preview card for a registered project asset referenced in
 * an agent message. Double-click (or the maximize button) opens the full
 * preview; dragging hands the asset off to the timeline drop targets.
 */
export function InlineAssetPreview({
  projectId,
  asset,
  onPreview,
}: {
  projectId: string;
  asset: ProjectAsset;
  onPreview?: (asset: ProjectAsset) => void;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.agentDock.inlinePreview;
  const src = projectAssetStreamUrl(projectId, asset.id);
  const filename = filenameFromPath(asset.path);
  const KindIcon = KIND_ICONS[asset.kind] ?? ImageIcon;

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    writeProjectAssetDrag(event.dataTransfer, {
      assetId: asset.id,
      kind: asset.kind,
      name: filename,
      durationMs: asset.metadata?.durationMs,
    });
  };

  const openPreview = () => onPreview?.(asset);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={openPreview}
      title={labels.hint}
      className="border-border bg-background hover:border-primary group cursor-grab overflow-hidden rounded-md border active:cursor-grabbing"
    >
      <div className="border-border bg-muted/40 flex items-center gap-1.5 border-b px-2 py-1 text-[10px]">
        <GripVertical
          className="text-muted-foreground size-3 shrink-0"
          aria-hidden="true"
        />
        <KindIcon
          className="text-muted-foreground size-3 shrink-0"
          aria-hidden="true"
        />
        <span className="text-foreground min-w-0 flex-1 truncate font-medium">
          {filename}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openPreview();
          }}
          aria-label={labels.preview}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <Maximize2 className="size-3" />
        </button>
      </div>
      <InlineAssetBody asset={asset} src={src} filename={filename} />
    </div>
  );
}

function InlineAssetBody({
  asset,
  src,
  filename,
}: {
  asset: ProjectAsset;
  src: string;
  filename: string;
}) {
  if (asset.kind === 'image') {
    return (
      <img
        src={src}
        alt={filename}
        draggable={false}
        className="max-h-64 w-full object-contain"
        loading="lazy"
      />
    );
  }
  if (asset.kind === 'video') {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className="max-h-64 w-full bg-black"
      />
    );
  }
  if (asset.kind === 'audio') {
    return (
      <audio src={src} controls preload="metadata" className="w-full p-2" />
    );
  }
  return null;
}
