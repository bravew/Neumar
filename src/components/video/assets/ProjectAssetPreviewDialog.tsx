import { FileAudio, Image as ImageIcon } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { VideoProject } from '@/shared/types/video';

import {
  projectAssetDisplayName,
  projectAssetDisplaySubtitle,
  projectAssetPreviewMedia,
  projectAssetStreamUrl,
  projectAssetThumbnailUrl,
} from './ProjectAssetTile';

type ProjectAsset = VideoProject['assets'][number];

interface ProjectAssetPreviewDialogProps {
  projectId: string;
  asset: ProjectAsset | null;
  onOpenChange: (open: boolean) => void;
}

export function ProjectAssetPreviewDialog({
  projectId,
  asset,
  onOpenChange,
}: ProjectAssetPreviewDialogProps) {
  const open = asset !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {asset ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate text-sm">
                {projectAssetDisplayName(asset)}
              </DialogTitle>
              <DialogDescription className="font-mono text-[10px]">
                {projectAssetDisplaySubtitle(asset)}
              </DialogDescription>
            </DialogHeader>
            <PreviewBody projectId={projectId} asset={asset} />
            <Metadata asset={asset} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  projectId,
  asset,
}: {
  projectId: string;
  asset: ProjectAsset;
}) {
  const preview = projectAssetPreviewMedia(projectId, asset);
  const src =
    preview.url ??
    projectAssetThumbnailUrl(projectId, asset) ??
    projectAssetStreamUrl(projectId, asset.id);

  if (asset.kind === 'image') {
    return (
      <div className="bg-muted flex max-h-[60vh] items-center justify-center overflow-hidden rounded">
        <img
          src={src}
          alt={asset.path}
          className="max-h-[60vh] max-w-full object-contain"
        />
      </div>
    );
  }
  if (asset.kind === 'video') {
    if (preview.kind === 'image') {
      return (
        <div className="bg-muted flex max-h-[60vh] items-center justify-center overflow-hidden rounded">
          <img
            src={src}
            alt={asset.path}
            className="max-h-[60vh] max-w-full object-contain"
          />
        </div>
      );
    }
    return (
      <div className="bg-muted overflow-hidden rounded">
        <video
          src={src}
          poster={preview.poster ?? undefined}
          controls
          className="max-h-[60vh] w-full"
          preload="metadata"
        />
      </div>
    );
  }
  if (asset.kind === 'audio') {
    return (
      <div className="bg-muted text-muted-foreground flex flex-col items-center gap-3 rounded p-6">
        <FileAudio className="size-12" />
        <audio src={src} controls className="w-full" preload="metadata" />
      </div>
    );
  }
  return (
    <div className="bg-muted text-muted-foreground flex items-center justify-center gap-2 rounded p-8 text-xs">
      <ImageIcon className="size-5" />
      <span>Preview not supported for this asset kind.</span>
    </div>
  );
}

function Metadata({ asset }: { asset: ProjectAsset }) {
  const m = asset.metadata ?? {};
  const items: Array<[string, string]> = [
    ['Kind', asset.kind],
    ...(m.durationMs
      ? ([['Duration', `${(m.durationMs / 1000).toFixed(2)}s`]] as Array<
          [string, string]
        >)
      : []),
    ...(m.width && m.height
      ? ([['Dimensions', `${m.width}×${m.height}`]] as Array<[string, string]>)
      : []),
    ...(m.frameRate
      ? ([['FPS', m.frameRate.toFixed(2)]] as Array<[string, string]>)
      : []),
    ...(m.codec ? ([['Codec', m.codec]] as Array<[string, string]>) : []),
    ...(m.fileSize
      ? ([['Size', formatBytes(m.fileSize)]] as Array<[string, string]>)
      : []),
  ];
  if (items.length === 0) return null;
  return (
    <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between">
          <dt className="uppercase">{label}</dt>
          <dd className="text-foreground font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
