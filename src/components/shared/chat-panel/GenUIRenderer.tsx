import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  ImageIcon,
  Info,
  Loader2,
  Music,
  Video,
  type LucideIcon,
} from 'lucide-react';

import { usePreviewUrl } from '@/shared/hooks/usePreviewUrl';
import { cn } from '@/shared/lib/utils';
import type {
  GenUIEnvelope,
  GenUIFileCard,
  GenUILinkCard,
  GenUIMediaCard,
  GenUIStatusCard,
} from '@/shared/types/gen-ui';

import { GenUITableCard } from './GenUITableCard';

export interface GenUIRendererProps {
  envelope: GenUIEnvelope;
  className?: string;
}

export function GenUIRenderer({ envelope, className }: GenUIRendererProps) {
  switch (envelope.$genui) {
    case 'MediaCard':
      return <MediaCard card={envelope} className={className} />;
    case 'FileCard':
      return <FileCard card={envelope} className={className} />;
    case 'LinkCard':
      return <LinkCard card={envelope} className={className} />;
    case 'StatusCard':
      return <StatusCard card={envelope} className={className} />;
    case 'TableCard':
      return <GenUITableCard card={envelope} className={className} />;
    default:
      return null;
  }
}

function MediaCard({
  card,
  className,
}: {
  card: GenUIMediaCard;
  className?: string;
}) {
  const { caption, kind, mime, path, title, url } = card.props;
  const mediaKind = kind ?? inferMediaKind(mime, path ?? url);
  const preview = usePreviewUrl({ path, content: url });
  const displayTitle = title ?? basename(path) ?? url;

  if (!mediaKind || (!path && !url)) return null;

  return (
    <section className={cn(cardShell(), className)}>
      {displayTitle && (
        <CardHeader icon={mediaIcon(mediaKind)} title={displayTitle} />
      )}
      <div className="bg-muted/20 overflow-hidden rounded-md">
        {preview.loading && <div className="bg-muted h-36 animate-pulse" />}
        {preview.error && (
          <div className="text-destructive px-3 py-2 text-xs break-words">
            {preview.error}
          </div>
        )}
        {!preview.loading && !preview.error && preview.url && (
          <MediaElement
            kind={mediaKind}
            src={preview.url}
            title={displayTitle ?? caption ?? ''}
          />
        )}
      </div>
      {caption && (
        <p className="text-muted-foreground mt-2 text-xs">{caption}</p>
      )}
    </section>
  );
}

function MediaElement({
  kind,
  src,
  title,
}: {
  kind: 'image' | 'video' | 'audio';
  src: string;
  title: string;
}) {
  if (kind === 'image') {
    return (
      <img
        src={src}
        alt={title}
        className="max-h-80 w-full object-contain"
        loading="lazy"
      />
    );
  }

  if (kind === 'video') {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className="max-h-80 w-full bg-black"
      />
    );
  }

  return <audio src={src} controls preload="metadata" className="w-full p-2" />;
}

function FileCard({
  card,
  className,
}: {
  card: GenUIFileCard;
  className?: string;
}) {
  const { description, path, sizeBytes, title, url } = card.props;
  const displayTitle = title ?? basename(path) ?? url ?? '';
  const body = (
    <div className={cn(cardShell(), 'flex items-start gap-3', className)}>
      <FileText className="text-primary mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-sm font-medium">
          {displayTitle || path}
        </div>
        {description && (
          <div className="text-muted-foreground mt-0.5 text-xs break-words">
            {description}
          </div>
        )}
        {(path || sizeBytes !== undefined) && (
          <div className="text-muted-foreground/70 mt-1 flex min-w-0 items-center gap-2 text-[11px]">
            {path && <span className="truncate">{path}</span>}
            {sizeBytes !== undefined && (
              <span className="shrink-0">{formatBytes(sizeBytes)}</span>
            )}
          </div>
        )}
      </div>
      {url && (
        <ExternalLink className="text-muted-foreground size-3 shrink-0" />
      )}
    </div>
  );

  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {body}
    </a>
  ) : (
    body
  );
}

function LinkCard({
  card,
  className,
}: {
  card: GenUILinkCard;
  className?: string;
}) {
  const { description, href, title } = card.props;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(cardShell(), 'hover:bg-muted/40 block', className)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <ExternalLink className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div className="text-foreground truncate text-sm font-medium">
            {title ?? href}
          </div>
          {description && (
            <div className="text-muted-foreground mt-0.5 text-xs break-words">
              {description}
            </div>
          )}
          {title && (
            <div className="text-muted-foreground/70 mt-1 truncate text-[11px]">
              {href}
            </div>
          )}
        </div>
      </div>
    </a>
  );
}

function StatusCard({
  card,
  className,
}: {
  card: GenUIStatusCard;
  className?: string;
}) {
  const { detail, status = 'info', title } = card.props;
  const Icon = statusIcon(status);
  return (
    <section className={cn(cardShell(), 'flex items-start gap-3', className)}>
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          status === 'success' && 'text-emerald-500',
          status === 'error' && 'text-destructive',
          status === 'warning' && 'text-amber-500',
          (status === 'pending' || status === 'running') &&
            'animate-spin text-blue-500',
          status === 'info' && 'text-primary',
        )}
      />
      <div className="min-w-0">
        {title && (
          <div className="text-foreground text-sm font-medium">{title}</div>
        )}
        {detail && (
          <div className="text-muted-foreground mt-0.5 text-xs break-words">
            {detail}
          </div>
        )}
        {!title && !detail && (
          <div className="text-muted-foreground text-xs">{status}</div>
        )}
      </div>
    </section>
  );
}

function CardHeader({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="mb-2 flex min-w-0 items-center gap-2">
      <Icon className="text-primary size-4 shrink-0" />
      <div className="text-foreground min-w-0 truncate text-sm font-medium">
        {title}
      </div>
    </div>
  );
}

function cardShell(): string {
  return 'border-border/60 bg-background my-2 rounded-lg border p-3';
}

function inferMediaKind(
  mime: string | undefined,
  source: string | undefined,
): 'image' | 'video' | 'audio' | null {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  const ext = source?.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
  return null;
}

function mediaIcon(kind: 'image' | 'video' | 'audio'): LucideIcon {
  if (kind === 'image') return ImageIcon;
  if (kind === 'video') return Video;
  return Music;
}

function basename(path: string | undefined): string | undefined {
  return path?.split('/').pop();
}

function statusIcon(status: GenUIStatusCard['props']['status']) {
  switch (status) {
    case 'success':
      return CheckCircle2;
    case 'error':
      return AlertCircle;
    case 'warning':
      return AlertCircle;
    case 'pending':
    case 'running':
      return Loader2;
    case 'info':
      return Info;
    default:
      return Clock;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
