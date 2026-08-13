import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { resolveProjectPath } from '../fs';
import type { CritiqueArtifactRef } from '../types';

const TEXT_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
const SVG_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
const FALLBACK_MEDIA_TYPE = 'application/octet-stream';
const MEDIA_TYPE_EXTENSIONS = {
  'text/html': 'html',
  'text/css': 'css',
  'text/markdown': 'md',
  'application/json': 'json',
  'image/svg+xml': 'svg',
  'text/plain': 'txt',
} as const;

export class CritiqueArtifactEmptyError extends Error {
  constructor() {
    super('Critique artifact body is empty');
    this.name = 'CritiqueArtifactEmptyError';
  }
}

export class CritiqueArtifactTooLargeError extends Error {
  constructor(
    readonly byteLength: number,
    readonly maxBytes: number,
  ) {
    super(`Critique artifact exceeds ${maxBytes} byte limit`);
    this.name = 'CritiqueArtifactTooLargeError';
  }
}

export interface WriteCritiqueArtifactInput {
  body: string | Buffer;
  mediaType: string;
}

export async function writeCritiqueArtifact(
  projectId: string,
  runId: string,
  input: WriteCritiqueArtifactInput,
): Promise<CritiqueArtifactRef> {
  const buffer =
    typeof input.body === 'string'
      ? Buffer.from(input.body, 'utf-8')
      : input.body;
  if (buffer.byteLength === 0) throw new CritiqueArtifactEmptyError();

  const mediaType = canonicalCritiqueArtifactMediaType(input.mediaType);
  const maxBytes = maxBytesForMediaType(mediaType);
  if (buffer.byteLength > maxBytes) {
    throw new CritiqueArtifactTooLargeError(buffer.byteLength, maxBytes);
  }

  const extension = critiqueArtifactExtensionForMediaType(mediaType);
  const target = resolveProjectPath(
    projectId,
    `critique/${runId}/artifact.${extension}`,
  );
  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
  await writeBufferAtomic(target.absolutePath, buffer);

  return {
    runId,
    mediaType,
    byteLength: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    url: `/design/projects/${encodeURIComponent(projectId)}/design-jury/${encodeURIComponent(runId)}/artifact`,
  };
}

export function canonicalCritiqueArtifactMediaType(raw: string): string {
  const mediaType = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mediaType in MEDIA_TYPE_EXTENSIONS) return mediaType;
  return FALLBACK_MEDIA_TYPE;
}

export function critiqueArtifactExtensionForMediaType(
  mediaType: string,
): string {
  return (
    MEDIA_TYPE_EXTENSIONS[
      canonicalCritiqueArtifactMediaType(
        mediaType,
      ) as keyof typeof MEDIA_TYPE_EXTENSIONS
    ] ?? 'bin'
  );
}

export function critiqueArtifactMediaTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    case '.svg':
      return 'image/svg+xml';
    case '.txt':
      return 'text/plain';
    default:
      return FALLBACK_MEDIA_TYPE;
  }
}

async function writeBufferAtomic(filePath: string, buffer: Buffer) {
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(temp, 'wx');
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, filePath);
    await fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

async function fsyncDirectory(dirPath: string) {
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(dirPath, fsConstants.O_RDONLY);
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every development filesystem.
  } finally {
    await handle?.close().catch(() => {});
  }
}

function maxBytesForMediaType(mediaType: string) {
  return mediaType === 'image/svg+xml'
    ? SVG_ARTIFACT_MAX_BYTES
    : TEXT_ARTIFACT_MAX_BYTES;
}

export const CRITIQUE_ARTIFACT_WRITER_INTERNALS = {
  TEXT_ARTIFACT_MAX_BYTES,
  SVG_ARTIFACT_MAX_BYTES,
  FALLBACK_MEDIA_TYPE,
};
