import { useEffect, useState } from 'react';

import { Code2, Eye, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { assetPreviewUrl, assetRawUrl } from '@/shared/assets/api';
import type { Asset } from '@/shared/assets/types';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  DownloadButton,
  isToggleableText,
  TextPreview,
} from './AssetTextPreview';

interface AssetPreviewDialogProps {
  asset: Asset | null;
  open: boolean;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (asset: Asset) => void;
}

export function AssetPreviewDialog({
  asset,
  open,
  deleting,
  onOpenChange,
  onDelete,
}: AssetPreviewDialogProps) {
  const { t } = useLanguage();
  const s = t.assets;
  const name =
    asset?.title || asset?.storagePath || asset?.id || s.previewTitle;

  // Some preview surfaces (markdown, HTML, code) can render either the
  // structured/rendered view or the raw source. We track that toggle here so
  // the right-side rail can show a "Show raw" / "Show rendered" button.
  const [showRaw, setShowRaw] = useState(false);
  const supportsToggle =
    asset?.kind === 'text' && isToggleableText(asset.mime, asset.title ?? '');

  // Reset the toggle when switching to a different asset so the next file
  // opens in its default rendered view.
  useEffect(() => {
    setShowRaw(false);
  }, [asset?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {asset
              ? `${asset.kind.toUpperCase()} · ${asset.mime}`
              : s.previewTitle}
          </DialogDescription>
        </DialogHeader>
        {asset ? (
          <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="bg-muted flex min-h-0 min-w-0 overflow-hidden">
              <PreviewSurface asset={asset} name={name} showRaw={showRaw} />
            </div>
            <aside className="border-border min-h-0 space-y-4 overflow-y-auto border-l p-4">
              <div className="flex flex-wrap gap-2">
                {supportsToggle ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => setShowRaw((v) => !v)}
                  >
                    {showRaw ? (
                      <Eye className="size-4" aria-hidden />
                    ) : (
                      <Code2 className="size-4" aria-hidden />
                    )}
                    {showRaw ? s.viewRendered : s.viewRaw}
                  </Button>
                ) : null}
                <DownloadButton asset={asset} className="flex-1 gap-2" />
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => onDelete(asset)}
                  disabled={deleting}
                  className="gap-2"
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-4" aria-hidden />
                  )}
                  {deleting ? s.deleting : s.delete}
                </Button>
              </div>
              <Metadata asset={asset} />
            </aside>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewSurface({
  asset,
  name,
  showRaw,
}: {
  asset: Asset;
  name: string;
  showRaw: boolean;
}) {
  const { t } = useLanguage();
  const s = t.assets;
  const preview = assetPreviewUrl(asset.id);
  const raw = assetRawUrl(asset.id);

  // For everything except text we center the content; text fills the
  // available area so its own scrollbar shows up inside the dialog.
  if (asset.kind === 'image') {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto">
        <img
          src={preview}
          alt={s.imageAlt.replace('{name}', name)}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  if (asset.kind === 'video') {
    return (
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <video
          src={raw}
          poster={preview}
          controls
          className="max-h-full max-w-full bg-black"
        />
      </div>
    );
  }
  if (asset.kind === 'audio') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <audio src={raw} controls className="w-full max-w-xl" />
      </div>
    );
  }
  if (asset.kind === 'pdf') {
    return (
      <iframe
        src={raw}
        title={name}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="flex-1 border-0 bg-white"
      />
    );
  }
  if (asset.kind === 'text') {
    return <TextPreview asset={asset} name={name} showRaw={showRaw} />;
  }
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-muted-foreground text-sm">{s.previewUnavailable}</p>
        <DownloadButton asset={asset} />
      </div>
    </div>
  );
}

function Metadata({ asset }: { asset: Asset }) {
  const { t } = useLanguage();
  const s = t.assets;
  const rows = [
    [s.source, sourceLabel(asset.source, s)],
    [s.kind, asset.kind],
    [s.mime, asset.mime],
    [s.bytes, formatBytes(asset.bytes)],
    [s.dimensions, dimensions(asset)],
    [s.duration, duration(asset.durationMs)],
    [s.captured, formatDate(asset.capturedAt)],
    [s.imported, formatDate(asset.importedAt)],
    [s.modified, formatDate(asset.modifiedAt)],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-semibold">{s.metadata}</h3>
        <dl className="mt-2 space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[90px_minmax(0,1fr)] gap-2"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <TextBlock title={s.tags} value={asset.tags.join(', ') || s.noTags} />
      <TextBlock title={s.description} value={asset.description} />
      <TextBlock title={s.extractedText} value={asset.ocrText} />
      <TextBlock title={s.transcript} value={asset.transcript} />
    </div>
  );
}

function TextBlock({ title, value }: { title: string; value: string | null }) {
  if (!value) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-1 max-h-32 overflow-y-auto text-sm whitespace-pre-wrap">
        {value}
      </p>
    </section>
  );
}

function dimensions(asset: Asset): string {
  return asset.width && asset.height ? `${asset.width} x ${asset.height}` : '';
}

function duration(durationMs: number | null): string {
  return durationMs ? `${Math.round(durationMs / 1000)}s` : '';
}

function formatDate(value: number | null): string {
  return value ? new Date(value).toLocaleString() : '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

function sourceLabel(
  source: Asset['source'],
  s: Record<string, string>,
): string {
  const labels: Record<Asset['source'], string> = {
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
  return labels[source];
}
