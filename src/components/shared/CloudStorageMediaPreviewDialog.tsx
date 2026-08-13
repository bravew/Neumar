import { type ReactNode } from 'react';

import {
  Calendar,
  Camera,
  FileText,
  Folder,
  MapPin,
  Tag,
  Users,
} from 'lucide-react';

import type { CloudFile } from '@/components/library/cloudStorageLibraryUtils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface CloudStorageMediaPreviewDialogProps {
  connectionId: string;
  item: CloudFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MediaMetadata = NonNullable<CloudFile['mediaMetadata']>;
type FileInfo = NonNullable<MediaMetadata['fileInfo']>;

export function CloudStorageMediaPreviewDialog({
  connectionId,
  item,
  open,
  onOpenChange,
}: CloudStorageMediaPreviewDialogProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  if (!item) return null;

  const contentUrl = `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}/items/${encodeURIComponent(item.id)}/content`;
  const thumbUrl = thumbnailUrl(item, connectionId);
  const metadata = item.mediaMetadata;
  const fileInfo = metadata?.fileInfo;
  const geo = metadata?.geo;
  const kind = item.isFolder
    ? s.mediaKindFolders
    : item.mimeType?.startsWith('video/')
      ? s.mediaKindVideos
      : item.mimeType?.startsWith('image/')
        ? s.mediaKindImages
        : s.mediaKindDocuments;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[95vw] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-border border-b px-4 py-3">
          <DialogTitle className="pr-8">{item.name}</DialogTitle>
          <DialogDescription>{kind}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="bg-muted relative flex h-full w-full items-center justify-center overflow-hidden">
            {item.isFolder ? (
              <Folder className="text-muted-foreground size-16" aria-hidden />
            ) : item.mimeType?.startsWith('video/') ? (
              <video
                className="size-full bg-black object-contain"
                controls
                poster={thumbUrl}
                preload="metadata"
                src={contentUrl}
              />
            ) : item.mimeType?.startsWith('image/') ? (
              <img
                src={contentUrl}
                alt={item.name}
                className="size-full object-contain"
                decoding="async"
              />
            ) : (
              <FileText className="text-muted-foreground size-16" aria-hidden />
            )}
          </div>

          <div className="border-border space-y-4 overflow-y-auto border-l p-4 text-sm">
            <MetadataSection title={s.previewFileDetails}>
              <MetadataRow label={s.previewFileName} value={item.name} />
              <MetadataRow label={s.previewMimeType} value={item.mimeType} />
              <MetadataRow
                label={s.previewFileSize}
                value={formatBytes(item.size)}
              />
              <MetadataRow
                label={s.previewDimensions}
                value={formatDimensions(fileInfo)}
              />
              <MetadataRow
                label={s.previewDuration}
                value={formatDuration(fileInfo?.durationSeconds)}
              />
              <MetadataRow
                label={s.previewCreated}
                value={formatDate(item.createdAt)}
              />
              <MetadataRow
                label={s.previewModified}
                value={formatDate(item.modifiedAt)}
              />
            </MetadataSection>

            <MetadataSection
              title={s.previewMediaDetails}
              icon={<Calendar className="size-4" aria-hidden />}
            >
              <MetadataRow
                label={s.previewTakenAt}
                value={formatDate(metadata?.takenAt)}
              />
              <MetadataRow
                label={s.previewImportedAt}
                value={formatDate(metadata?.importedAt)}
              />
              <MetadataRow
                label={s.previewDescription}
                value={metadata?.description}
              />
              <MetadataRow
                label={s.previewRating}
                value={metadata?.rating?.toString()}
              />
            </MetadataSection>

            <MetadataSection
              title={s.previewLocation}
              icon={<MapPin className="size-4" aria-hidden />}
            >
              <MetadataRow label={s.previewPlace} value={formatPlace(geo)} />
              <MetadataRow
                label={s.previewCoordinates}
                value={formatCoordinates(geo)}
              />
              {geo ? (
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href={`https://www.google.com/maps/search/?api=1&query=${geo.latitude},${geo.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.previewOpenMap}
                </a>
              ) : null}
            </MetadataSection>

            <MetadataSection
              title={s.previewCamera}
              icon={<Camera className="size-4" aria-hidden />}
            >
              <MetadataRow
                label={s.previewCameraMake}
                value={metadata?.camera?.make}
              />
              <MetadataRow
                label={s.previewCameraModel}
                value={metadata?.camera?.model}
              />
              <MetadataRow
                label={s.previewLens}
                value={metadata?.camera?.lensModel}
              />
              <MetadataRow
                label={s.previewExposure}
                value={formatExposure(metadata?.camera)}
              />
            </MetadataSection>

            <MetadataSection
              title={s.previewPeople}
              icon={<Users className="size-4" aria-hidden />}
            >
              <ChipList
                values={metadata?.people?.map(
                  (person) => person.name || person.id,
                )}
                empty={s.previewNone}
              />
            </MetadataSection>

            <MetadataSection
              title={s.previewTags}
              icon={<Tag className="size-4" aria-hidden />}
            >
              <ChipList
                values={metadata?.tags?.map((tag) => tag.value)}
                empty={s.previewNone}
              />
            </MetadataSection>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetadataSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function MetadataRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground min-w-0 break-words">{value}</span>
    </div>
  );
}

function ChipList({
  values,
  empty,
}: {
  values: string[] | undefined;
  empty: string;
}) {
  const cleanValues = values?.filter(Boolean) ?? [];
  if (cleanValues.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {cleanValues.map((value) => (
        <span
          key={value}
          className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function thumbnailUrl(
  item: CloudFile,
  connectionId: string,
): string | undefined {
  const value = item.thumbnailUrl;
  if (!value?.startsWith('immich-thumbnail:')) return value;
  const assetId = value.slice('immich-thumbnail:'.length);
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}/items/${encodeURIComponent(assetId)}/thumbnail`;
}

function formatBytes(value: number | undefined): string | undefined {
  if (!value || value <= 0) return undefined;
  return (
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
    }).format(value / 1024 / 1024) + ' MB'
  );
}

function formatDate(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDimensions(fileInfo: FileInfo | undefined): string | undefined {
  if (!fileInfo) return undefined;
  const width = fileInfo.width;
  const height = fileInfo.height;
  return typeof width === 'number' && typeof height === 'number'
    ? `${width} x ${height}`
    : undefined;
}

function formatDuration(value: number | undefined): string | undefined {
  if (!value) return undefined;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatPlace(
  geo: MediaMetadata['geo'] | undefined,
): string | undefined {
  if (!geo) return undefined;
  return [geo.city, geo.state, geo.country].filter(Boolean).join(', ');
}

function formatCoordinates(
  geo: MediaMetadata['geo'] | undefined,
): string | undefined {
  if (!geo) return undefined;
  return `${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}`;
}

function formatExposure(
  camera: MediaMetadata['camera'] | undefined,
): string | undefined {
  if (!camera) return undefined;
  return [
    camera.focalLengthMm ? `${camera.focalLengthMm}mm` : undefined,
    camera.apertureFNumber ? `f/${camera.apertureFNumber}` : undefined,
    camera.exposureSeconds ? `${camera.exposureSeconds}s` : undefined,
    camera.iso ? `ISO ${camera.iso}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}
