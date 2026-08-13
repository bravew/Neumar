import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validatePath } from '@/shared/services/ffmpeg';

import {
  getVideoProjectCacheDirForRoot,
  getVideoProjectDirForRoot,
  getVideoProjectRoot,
} from './store';

export type VideoStorageRoot = 'project' | 'cache';

export type VideoStorageEntryKind = 'directory' | 'file' | 'symlink' | 'other';

export interface VideoStorageTreeEntry {
  name: string;
  path: string;
  kind: VideoStorageEntryKind;
  sizeBytes: number;
  updatedAt: string;
}

export interface VideoStorageTree {
  projectId: string;
  root: VideoStorageRoot;
  path: string;
  entries: VideoStorageTreeEntry[];
  totalSizeBytes: number;
}

export interface ListVideoProjectStorageTreeInput {
  root?: VideoStorageRoot;
  path?: string;
}

export function parseVideoStorageRoot(
  value: string | undefined,
): VideoStorageRoot {
  if (!value || value === 'project') return 'project';
  if (value === 'cache') return 'cache';
  throw new Error('Invalid video storage root');
}

export async function listVideoProjectStorageTree(
  projectId: string,
  input: ListVideoProjectStorageTreeInput = {},
): Promise<VideoStorageTree> {
  const workspaceRoot = getVideoProjectRoot(projectId);
  const root = input.root ?? 'project';
  const storageRoot =
    root === 'cache'
      ? getVideoProjectCacheDirForRoot(workspaceRoot, projectId)
      : getVideoProjectDirForRoot(workspaceRoot, projectId);
  const directory = resolveStoragePath(storageRoot, input.path);
  const relativePath = relativeStoragePath(storageRoot, directory);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (root === 'cache' && relativePath === '' && isNotFoundError(error)) {
      return {
        projectId,
        root,
        path: '',
        entries: [],
        totalSizeBytes: 0,
      };
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error('Invalid video storage path');
  }
  if (!stat.isDirectory()) {
    throw new Error('Video storage path is not a directory');
  }

  await assertWithinStorageRoot(storageRoot, directory);

  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map((dirent) => storageTreeEntry(storageRoot, directory, dirent)),
  );
  entries.sort(compareStorageEntries);

  return {
    projectId,
    root,
    path: relativePath,
    entries,
    totalSizeBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
  };
}

function resolveStoragePath(root: string, requestedPath: string | undefined) {
  const normalizedPath = normalizeRequestedPath(requestedPath);
  const candidate = path.resolve(root, normalizedPath);
  return validatePath(candidate, root, 'write');
}

function normalizeRequestedPath(requestedPath: string | undefined): string {
  const value = requestedPath?.trim() ?? '';
  if (value.includes('\u0000')) {
    throw new Error('Invalid video storage path');
  }
  if (path.isAbsolute(value)) {
    throw new Error('Invalid video storage path');
  }
  return value;
}

async function storageTreeEntry(
  root: string,
  directory: string,
  dirent: Dirent,
): Promise<VideoStorageTreeEntry> {
  const absolutePath = path.join(directory, dirent.name);
  const stat = await fs.lstat(absolutePath);
  return {
    name: dirent.name,
    path: relativeStoragePath(root, absolutePath),
    kind: storageEntryKind(dirent),
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function storageEntryKind(dirent: Dirent): VideoStorageEntryKind {
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isFile()) return 'file';
  if (dirent.isSymbolicLink()) return 'symlink';
  return 'other';
}

function relativeStoragePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function compareStorageEntries(
  left: VideoStorageTreeEntry,
  right: VideoStorageTreeEntry,
): number {
  if (left.kind === 'directory' && right.kind !== 'directory') return -1;
  if (left.kind !== 'directory' && right.kind === 'directory') return 1;
  return left.name.localeCompare(right.name);
}

async function assertWithinStorageRoot(
  storageRoot: string,
  directory: string,
): Promise<void> {
  const normalizedRoot = path.resolve(storageRoot);
  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(normalizedRoot);
  } catch (error) {
    if (isNotFoundError(error)) {
      resolvedRoot = normalizedRoot;
    } else {
      throw error;
    }
  }
  const resolvedDirectory = await fs.realpath(directory);
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  if (
    resolvedDirectory !== resolvedRoot &&
    !resolvedDirectory.startsWith(rootWithSep)
  ) {
    throw new Error('Invalid video storage path');
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
