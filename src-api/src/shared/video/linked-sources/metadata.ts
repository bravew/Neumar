import path from 'node:path';

import { MEDIA_KIND_EXTENSIONS } from '@/shared/integrations/cloud-storage/media-kind-filter';
import type { CloudFile } from '@/shared/integrations/cloud-storage/types';
import { probeFile } from '@/shared/services/ffmpeg';
import type { LinkedAssetKind } from '@/shared/video/types';

const MIME_KIND_PREFIXES: Array<[string, LinkedAssetKind]> = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
];

export function linkedAssetKind(
  file: Pick<CloudFile, 'name' | 'mimeType'>,
): LinkedAssetKind {
  for (const [prefix, kind] of MIME_KIND_PREFIXES) {
    if (file.mimeType.startsWith(prefix)) return kind;
  }
  const ext = extensionOf(file.name).slice(1);
  if (MEDIA_KIND_EXTENSIONS.image.has(ext)) return 'image';
  if (MEDIA_KIND_EXTENSIONS.video.has(ext)) return 'video';
  if (MEDIA_KIND_EXTENSIONS.audio.has(ext)) return 'audio';
  return 'other';
}

export function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function durationMsFromCloudFile(file: CloudFile): number | undefined {
  const seconds = file.mediaMetadata?.fileInfo?.durationSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? Math.max(0, Math.round(seconds * 1000))
    : undefined;
}

export function widthFromCloudFile(file: CloudFile): number | undefined {
  return finitePositive(file.mediaMetadata?.fileInfo?.width);
}

export function heightFromCloudFile(file: CloudFile): number | undefined {
  return finitePositive(file.mediaMetadata?.fileInfo?.height);
}

export async function probeLocalMetadata(
  filePath: string,
  workspaceRoot: string,
): Promise<{
  durationMs?: number;
  width?: number;
  height?: number;
}> {
  try {
    const probe = await probeFile(filePath, workspaceRoot);
    const video = probe.streams.find((stream) => stream.codecType === 'video');
    return {
      durationMs: Math.round(probe.duration * 1000),
      width: finitePositive(video?.width),
      height: finitePositive(video?.height),
    };
  } catch {
    return {};
  }
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
