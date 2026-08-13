import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';

import type { EditorHandoffMediaMode, EditorHandoffMediaRef } from './types';

export interface CollectMediaInput {
  workspaceRoot: string;
  packageDir: string;
  mediaMode: EditorHandoffMediaMode;
  mediaRefs: EditorHandoffMediaRef[];
}

export async function collectHandoffMedia(
  input: CollectMediaInput,
): Promise<EditorHandoffMediaRef[]> {
  const mediaDir = path.join(input.packageDir, 'media');
  await fs.mkdir(mediaDir, { recursive: true });

  const collected: EditorHandoffMediaRef[] = [];
  for (const mediaRef of input.mediaRefs) {
    collected.push(await collectOneMediaRef(input, mediaDir, mediaRef));
  }
  return collected;
}

async function collectOneMediaRef(
  input: CollectMediaInput,
  mediaDir: string,
  mediaRef: EditorHandoffMediaRef,
): Promise<EditorHandoffMediaRef> {
  if (!mediaRef.path || mediaRef.missing) return mediaRef;
  const sourcePath = resolveWorkspacePath(input.workspaceRoot, mediaRef.path);
  if (!sourcePath) {
    return {
      ...mediaRef,
      missing: true,
      relinkRequired: true,
      placeholderReason: 'path outside workspace',
    };
  }

  try {
    const stat = await fs.stat(sourcePath);
    const checksumSha256 = await hashFile(sourcePath);
    if (input.mediaMode === 'link') {
      return {
        ...mediaRef,
        originalPathHint: sourcePath,
        checksumSha256,
        sizeBytes: stat.size,
        relinkRequired: true,
      };
    }

    const copiedPath = path.join(
      mediaDir,
      safeMediaFilename(mediaRef, sourcePath),
    );
    await fs.copyFile(sourcePath, copiedPath);
    return {
      ...mediaRef,
      copiedPath: path.relative(input.packageDir, copiedPath),
      originalPathHint: sourcePath,
      checksumSha256,
      sizeBytes: stat.size,
      relinkRequired: false,
    };
  } catch {
    return {
      ...mediaRef,
      missing: true,
      relinkRequired: true,
      placeholderReason: 'file not readable',
    };
  }
}

function resolveWorkspacePath(
  workspaceRoot: string,
  mediaPath: string,
): string | undefined {
  const absolutePath = path.isAbsolute(mediaPath)
    ? path.resolve(mediaPath)
    : path.resolve(workspaceRoot, mediaPath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return absolutePath;
}

function safeMediaFilename(
  mediaRef: EditorHandoffMediaRef,
  sourcePath: string,
): string {
  const ext = path.extname(sourcePath);
  const base = mediaRef.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `${base || 'media'}${ext}`;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await streamPipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}
