/**
 * FileTypeIcon — maps file extensions / MIME types to Phosphor icons.
 * Uses the clean minimal line-style icons (macOS SF Symbols aesthetic).
 */

import type { Icon } from '@phosphor-icons/react';
import {
  File,
  FileAudio,
  FileCode,
  FileCsv,
  FileDoc,
  FileHtml,
  FileImage,
  FilePdf,
  FilePpt,
  FileText,
  FileVideo,
  FileXls,
  FileZip,
} from '@phosphor-icons/react';

const EXT_MAP: Record<string, Icon> = {
  // Documents
  pdf: FilePdf,
  doc: FileDoc,
  docx: FileDoc,
  odt: FileDoc,
  rtf: FileDoc,
  txt: FileText,
  md: FileText,
  // Spreadsheets
  xls: FileXls,
  xlsx: FileXls,
  ods: FileXls,
  csv: FileCsv,
  // Presentations
  ppt: FilePpt,
  pptx: FilePpt,
  odp: FilePpt,
  // Images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  svg: FileImage,
  bmp: FileImage,
  ico: FileImage,
  tiff: FileImage,
  tif: FileImage,
  heic: FileImage,
  avif: FileImage,
  // Video
  mp4: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  mkv: FileVideo,
  webm: FileVideo,
  flv: FileVideo,
  wmv: FileVideo,
  m4v: FileVideo,
  // Audio
  mp3: FileAudio,
  wav: FileAudio,
  aac: FileAudio,
  ogg: FileAudio,
  flac: FileAudio,
  m4a: FileAudio,
  wma: FileAudio,
  // Archives
  zip: FileZip,
  tar: FileZip,
  gz: FileZip,
  bz2: FileZip,
  '7z': FileZip,
  rar: FileZip,
  // Code
  js: FileCode,
  jsx: FileCode,
  ts: FileCode,
  tsx: FileCode,
  py: FileCode,
  rb: FileCode,
  go: FileCode,
  rs: FileCode,
  java: FileCode,
  c: FileCode,
  cpp: FileCode,
  cs: FileCode,
  php: FileCode,
  swift: FileCode,
  kt: FileCode,
  sh: FileCode,
  bash: FileCode,
  zsh: FileCode,
  fish: FileCode,
  lua: FileCode,
  r: FileCode,
  scala: FileCode,
  html: FileHtml,
  htm: FileHtml,
  css: FileCode,
  scss: FileCode,
  sass: FileCode,
  less: FileCode,
  json: FileCode,
  yaml: FileCode,
  yml: FileCode,
  toml: FileCode,
  xml: FileCode,
  sql: FileCode,
  graphql: FileCode,
  vue: FileCode,
  svelte: FileCode,
};

const MIME_MAP: Record<string, Icon> = {
  'application/pdf': FilePdf,
  'application/msword': FileDoc,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    FileDoc,
  'application/vnd.ms-excel': FileXls,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileXls,
  'application/vnd.ms-powerpoint': FilePpt,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    FilePpt,
  'text/plain': FileText,
  'text/markdown': FileText,
  'text/csv': FileCsv,
  'text/html': FileHtml,
  'text/javascript': FileCode,
  'application/json': FileCode,
  'application/zip': FileZip,
  'application/x-zip-compressed': FileZip,
  'application/x-tar': FileZip,
  'application/gzip': FileZip,
  'application/x-7z-compressed': FileZip,
  'application/x-rar-compressed': FileZip,
};

/** Resolve the best Phosphor icon for a given filename and/or MIME type. */
export function getFileTypeIcon(filename?: string, mimeType?: string): Icon {
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext && EXT_MAP[ext]) return EXT_MAP[ext];
  }
  if (mimeType) {
    if (MIME_MAP[mimeType]) return MIME_MAP[mimeType];
    // Broad MIME prefix fallbacks
    if (mimeType.startsWith('image/')) return FileImage;
    if (mimeType.startsWith('video/')) return FileVideo;
    if (mimeType.startsWith('audio/')) return FileAudio;
    if (mimeType.startsWith('text/')) return FileText;
  }
  return File;
}

interface FileTypeIconProps {
  filename?: string;
  mimeType?: string;
  className?: string;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
}

/** Drop-in icon component — resolves the right icon from filename + MIME type. */
export function FileTypeIcon({
  filename,
  mimeType,
  className,
  weight = 'regular',
}: FileTypeIconProps) {
  const Icon = getFileTypeIcon(filename, mimeType);
  return <Icon className={className} weight={weight} />;
}
