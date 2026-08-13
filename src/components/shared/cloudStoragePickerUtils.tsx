import type { ComponentType, SVGProps } from 'react';

import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  Image,
  Presentation,
  Video,
  Volume2,
} from 'lucide-react';

import type {
  CloudFile,
  MediaKind,
} from '@/components/library/cloudStorageLibraryUtils';
import { API_BASE_URL } from '@/config';

export function kindLabel(kind: MediaKind, s: Record<string, string>) {
  const labels: Record<MediaKind, string> = {
    all: s.mediaKindAll,
    image: s.mediaKindImages,
    video: s.mediaKindVideos,
    audio: s.mediaKindAudio,
    document: s.mediaKindDocuments,
    folder: s.mediaKindFolders,
  };
  return labels[kind];
}

export function KindIcon({ kind }: { kind: MediaKind }) {
  const className = 'size-4';
  if (kind === 'image') return <Image className={className} aria-hidden />;
  if (kind === 'video') return <Video className={className} aria-hidden />;
  if (kind === 'audio') return <Volume2 className={className} aria-hidden />;
  if (kind === 'folder') return <Folder className={className} aria-hidden />;
  return <File className={className} aria-hidden />;
}

export function withPickerPreviewUrls(
  item: CloudFile,
  connectionId: string,
): CloudFile {
  if (!connectionId) return item;
  return {
    ...item,
    thumbnailUrl: resolvePreviewUrl(item.thumbnailUrl, connectionId),
    previewUrl: resolvePreviewUrl(item.previewUrl, connectionId),
  };
}

/**
 * Map a CloudFile to the lucide-react icon that best matches its content
 * type or filename extension. Returned as a component so the caller can
 * size/colour it freely. Returns `Folder` for directories and a generic
 * `File` for unknown types so the list view never renders empty.
 */
export type FileIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export function iconForCloudFile(item: CloudFile): FileIconComponent {
  if (item.isFolder) return Folder;
  const mime = (item.mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (mime === 'application/pdf') return FileType;
  if (
    mime.includes('spreadsheet') ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel'
  )
    return FileSpreadsheet;
  if (mime.includes('presentation') || mime === 'application/vnd.ms-powerpoint')
    return Presentation;
  if (mime.includes('wordprocessingml') || mime === 'application/msword')
    return FileText;
  if (mime.startsWith('text/')) return FileText;
  if (
    mime.includes('zip') ||
    mime.includes('compressed') ||
    mime.includes('archive')
  )
    return FileArchive;
  if (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime === 'application/x-sh'
  )
    return FileCode;

  // Fall back to filename extension when the MIME is unhelpful (e.g.
  // application/octet-stream is common for files Box hasn't classified).
  const ext = item.name?.split('.').pop()?.toLowerCase();
  if (!ext) return File;
  if (
    [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'heic',
      'heif',
      'svg',
      'tiff',
      'bmp',
    ].includes(ext)
  )
    return FileImage;
  if (['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv'].includes(ext))
    return FileVideo;
  if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(ext))
    return FileAudio;
  if (['pdf'].includes(ext)) return FileType;
  if (['csv', 'xls', 'xlsx', 'ods', 'numbers'].includes(ext))
    return FileSpreadsheet;
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return Presentation;
  if (['doc', 'docx', 'odt', 'pages', 'rtf', 'txt', 'md'].includes(ext))
    return FileText;
  if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz', 'tgz'].includes(ext))
    return FileArchive;
  if (
    [
      'js',
      'ts',
      'tsx',
      'jsx',
      'json',
      'yml',
      'yaml',
      'xml',
      'html',
      'css',
      'scss',
      'go',
      'py',
      'rb',
      'rs',
      'sh',
      'sql',
      'java',
      'kt',
      'c',
      'cpp',
      'h',
    ].includes(ext)
  )
    return FileCode;
  return File;
}

/**
 * Build the per-item thumbnail proxy URL for an inline preview (e.g. in
 * the list view). Returns undefined when the cloud provider hasn't set
 * a thumbnail sentinel — caller should fall back to a MIME icon.
 */
export function buildThumbnailUrl(
  item: CloudFile,
  connectionId: string,
): string | undefined {
  if (!connectionId || item.isFolder) return undefined;
  const raw = item.thumbnailUrl;
  if (!raw) return undefined;
  const match = /^[\w-]+-thumbnail:(.+)$/.exec(raw);
  if (!match) return raw.startsWith('http') ? raw : undefined;
  const assetId = match[1];
  if (!assetId) return undefined;
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}/items/${encodeURIComponent(assetId)}/thumbnail`;
}

function resolvePreviewUrl(
  value: string | undefined,
  connectionId: string,
): string | undefined {
  if (!value) return value;
  const match = /^([\w-]+)-thumbnail:(.+)$/.exec(value);
  if (!match) return value;
  const assetId = match[2];
  if (!assetId || !connectionId) return undefined;
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}/items/${encodeURIComponent(assetId)}/thumbnail`;
}
