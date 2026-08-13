import { FileAudio, FileText, Image, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { designBlobUrl } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignOutput } from '@/shared/types/design-mode';

const icons = {
  image: Image,
  video: Video,
  audio: FileAudio,
  document: FileText,
};

export function AssetCard({
  asset,
  projectId,
  onOpen,
  onVersions,
  onCompare,
  onProvenance,
}: {
  asset: DesignOutput;
  projectId?: string;
  onOpen: () => void;
  onVersions: () => void;
  onCompare: () => void;
  onProvenance: () => void;
}) {
  const { t } = useLanguage();
  const Icon = icons[asset.kind as keyof typeof icons] ?? FileText;
  return (
    <article className="border-border bg-card rounded-md border p-3">
      <div className="bg-muted flex aspect-video items-center justify-center rounded-md">
        <AssetPreview projectId={projectId} asset={asset} icon={Icon} />
      </div>
      <p className="mt-2 truncate text-sm font-medium">{asset.path}</p>
      <p className="text-muted-foreground truncate text-xs">
        {asset.provider ?? t.design.providerLocal} ·{' '}
        {asset.model ?? t.design.modelAuto}
      </p>
      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
        {t.design.assetDisclosureLine
          .replace('{kind}', asset.kind)
          .replace('{provider}', asset.provider ?? t.design.providerLocal)
          .replace('{model}', asset.model ?? t.design.modelAuto)
          .replace('{date}', asset.createdAt.slice(0, 10))}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
          {t.design.openAsset}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onVersions}>
          {t.design.assetVersions}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCompare}>
          {t.design.compare}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onProvenance}>
          {t.design.assetProvenance}
        </Button>
      </div>
    </article>
  );
}

function AssetPreview({
  projectId,
  asset,
  icon: Icon,
}: {
  projectId?: string;
  asset: DesignOutput;
  icon: typeof FileText;
}) {
  if (!projectId) return <Icon className="text-muted-foreground size-7" />;
  const src = designBlobUrl(projectId, asset.path);
  if (isImagePath(asset.path)) {
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full rounded-md object-cover"
        loading="lazy"
      />
    );
  }
  if (isVideoPath(asset.path)) {
    return (
      <video
        src={src}
        className="h-full w-full rounded-md object-cover"
        muted
      />
    );
  }
  if (isAudioPath(asset.path)) {
    return <FileAudio className="text-muted-foreground size-7" />;
  }
  return <Icon className="text-muted-foreground size-7" />;
}

function isImagePath(filePath: string) {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(filePath);
}

function isVideoPath(filePath: string) {
  return /\.(mp4|webm|mov)$/i.test(filePath);
}

function isAudioPath(filePath: string) {
  return /\.(mp3|wav|m4a|ogg)$/i.test(filePath);
}
