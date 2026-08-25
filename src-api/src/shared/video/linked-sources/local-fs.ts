import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { getAppDir, getHomeDir } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import type {
  CloudStorageAdapter,
  DownloadInit,
} from '@/shared/integrations/cloud-storage';
import { CloudStorageError } from '@/shared/integrations/cloud-storage';
import type {
  Capabilities,
  ChangeCursorInput,
  ChangePage,
  CloudFile,
  CopyMoveInput,
  ExportInput,
  FileContent,
  ListChildrenInput,
  ListResult,
  MetadataUpdateInput,
  SearchInput,
  UploadInput,
} from '@/shared/integrations/cloud-storage/types';
import { mimeFromExtension } from '@/shared/utils/mime-extension';
import { expandPath } from '@/shared/utils/paths';

const CAPABILITIES: Capabilities = {
  fullTextSearch: false,
  thumbnails: false,
  exportContent: false,
  watch: false,
  longPoll: false,
  sharedDrives: false,
  mediaMetadata: {
    structuredSearch: false,
    writableFields: [],
  },
};

const SENSITIVE_LOCAL_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.azure',
  '~/.config/gcloud',
  '~/.docker',
  '~/.kube',
  '~/.gnupg',
  '~/.npmrc',
  '~/.pypirc',
  '~/.netrc',
  '~/.git-credentials',
];

export class LocalFsLinkedSourceAdapter implements CloudStorageAdapter {
  readonly provider = 'local_fs' as const;

  constructor(private readonly rootPath: string) {}

  getCapabilities(): Capabilities {
    return CAPABILITIES;
  }

  async listChildren(
    input: ListChildrenInput = {},
  ): Promise<ListResult<CloudFile>> {
    const directory = await this.resolveWithinRoot(
      input.parentId ?? this.rootPath,
    );
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const offset = input.cursor ? Number(input.cursor) : 0;
    const limit = input.limit ?? 100;
    const page = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(offset, offset + limit);
    const items = await Promise.all(
      page.map((entry) => this.direntToCloudFile(directory, entry)),
    );
    const nextOffset = offset + page.length;
    return {
      items,
      nextCursor: nextOffset < entries.length ? String(nextOffset) : undefined,
      hasMore: nextOffset < entries.length,
      totalCount: entries.length,
    };
  }

  async search(input: SearchInput): Promise<ListResult<CloudFile>> {
    const query = input.query.trim().toLowerCase();
    const limit = input.limit ?? 100;
    const matches: CloudFile[] = [];
    const root = await this.resolveWithinRoot(input.parentId ?? this.rootPath);
    const stack = [root];
    while (stack.length > 0 && matches.length < limit) {
      const current = stack.pop()!;
      let entries: Array<{ name: string; isDirectory(): boolean }>;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const file = await this.direntToCloudFile(current, entry);
        if (entry.isDirectory()) {
          stack.push(file.id);
        }
        if (!query || file.name.toLowerCase().includes(query)) {
          matches.push(file);
          if (matches.length >= limit) break;
        }
      }
    }
    return { items: matches, hasMore: false };
  }

  async getMetadata(providerItemId: string): Promise<CloudFile> {
    const filePath = await this.resolveWithinRoot(providerItemId);
    const stat = await fs.stat(filePath);
    return pathToCloudFile(filePath, stat, this.rootPath);
  }

  /**
   * Absolute path of a file inside the granted root, containment-checked the
   * same way `download` checks it.
   *
   * Callers that only need the bytes on this machine (attaching linked media
   * into a project, for instance) can copy straight from this path instead of
   * pulling the file through a `Response` — no in-memory buffer, and on a
   * copy-on-write filesystem the copy costs no extra disk at all.
   */
  async resolveLocalFilePath(providerItemId: string): Promise<string> {
    const filePath = await this.resolveWithinRoot(providerItemId);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new CloudStorageError('unsupported', 'Cannot download a folder');
    }
    return filePath;
  }

  async download(
    providerItemId: string,
    init: DownloadInit = {},
  ): Promise<Response> {
    if (init.range) {
      throw new CloudStorageError(
        'unsupported',
        'Local linked source range downloads are not implemented',
      );
    }
    const filePath = await this.resolveWithinRoot(providerItemId);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new CloudStorageError('unsupported', 'Cannot download a folder');
    }
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      headers: {
        'content-length': String(stat.size),
        'content-type': mimeFromName(filePath),
      },
    });
  }

  exportContent(_input: ExportInput): Promise<FileContent> {
    return Promise.reject(
      new CloudStorageError('unsupported', 'Local export is not supported'),
    );
  }

  createFolder(_parentId: string | null, _name: string): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Local linked sources are read-only',
      ),
    );
  }

  upload(_input: UploadInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Local linked sources are read-only',
      ),
    );
  }

  updateMetadata(
    _providerItemId: string,
    _input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Local linked sources are read-only',
      ),
    );
  }

  move(_input: CopyMoveInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Local linked sources are read-only',
      ),
    );
  }

  copy(_input: CopyMoveInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Local linked sources are read-only',
      ),
    );
  }

  delete(_providerItemId: string, _permanent?: boolean): Promise<void> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Local linked sources are read-only',
      ),
    );
  }

  getChanges(_input: ChangeCursorInput): Promise<ChangePage> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Local change feeds are not enabled',
      ),
    );
  }

  private async resolveWithinRoot(rawPath: string): Promise<string> {
    const resolved = await realpathDirectoryOrFile(rawPath);
    if (!isEqualOrChild(resolved, this.rootPath)) {
      throw new CloudStorageError(
        'permission_denied',
        'Local linked source path escaped its granted root',
      );
    }
    return resolved;
  }

  private async direntToCloudFile(
    directory: string,
    entry: { name: string },
  ): Promise<CloudFile> {
    const filePath = path.join(directory, entry.name);
    const stat = await fs.stat(filePath);
    return pathToCloudFile(filePath, stat, this.rootPath);
  }
}

/**
 * Same trust rules as `assertSafeLocalSourceRoot`, for a single file rather
 * than a folder, and synchronous so it can stand in for `validateInputFile`
 * at the many places that resolve an asset's bytes.
 *
 * Used when a project references a master the user keeps outside the
 * workspace. The path is persisted in `project.json`, so it is re-checked on
 * every read rather than trusted because it passed once.
 */
export function assertSafeExternalMediaFile(rawPath: string): string {
  const resolved = path.resolve(expandPath(rawPath.trim()));
  if (!existsSync(resolved)) {
    throw new Error(`External media file not found: ${resolved}`);
  }
  const real = realpathSync(resolved);
  if (!statSync(real).isFile()) {
    throw new Error('External media must be a file');
  }
  if (!isTrustedLocalRoot(real)) {
    throw new Error('External media is outside trusted local roots');
  }
  const sensitive = sensitivePathMatch(real);
  if (sensitive) {
    throw new Error(`External media cannot use sensitive path ${sensitive}`);
  }
  return real;
}

export async function assertSafeLocalSourceRoot(
  rawPath: string,
): Promise<string> {
  const resolved = path.resolve(expandPath(rawPath.trim()));
  const real = await realpathDirectoryOrFile(resolved);
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new Error('Linked local source must be a directory');
  }
  if (!isTrustedLocalRoot(real)) {
    throw new Error('Linked local source is outside trusted local roots');
  }
  const sensitive = sensitivePathMatch(real);
  if (sensitive) {
    throw new Error(
      `Linked local source cannot use sensitive path ${sensitive}`,
    );
  }
  return real;
}

function pathToCloudFile(
  filePath: string,
  stat: { isDirectory(): boolean; size: number; birthtime: Date; mtime: Date },
  rootPath: string,
): CloudFile {
  return {
    id: filePath,
    name: path.basename(filePath),
    path: path.relative(rootPath, filePath) || path.basename(filePath),
    mimeType: stat.isDirectory() ? 'inode/directory' : mimeFromName(filePath),
    size: stat.isDirectory() ? 0 : stat.size,
    createdAt: stat.birthtime,
    modifiedAt: stat.mtime,
    parentId: filePath === rootPath ? null : path.dirname(filePath),
    isFolder: stat.isDirectory(),
    provider: 'local_fs',
  };
}

function mimeFromName(filePath: string): string {
  return (
    mimeFromExtension(path.extname(filePath)) ?? 'application/octet-stream'
  );
}

async function realpathDirectoryOrFile(rawPath: string): Promise<string> {
  const expanded = path.resolve(expandPath(rawPath));
  try {
    return await fs.realpath(expanded);
  } catch (error) {
    throw new Error(
      `Linked local source path does not exist: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isTrustedLocalRoot(filePath: string): boolean {
  return trustedRoots().some((root) => isEqualOrChild(filePath, root));
}

function trustedRoots(): string[] {
  const roots = [getHomeDir(), getAppDir()];
  const workDir = getSetting('workDir');
  if (workDir) roots.push(path.resolve(expandPath(workDir)));
  roots.push(os.tmpdir());
  if (process.platform === 'darwin') roots.push('/Volumes');
  return roots.map((root) => normalizePath(realpathIfExists(root)));
}

function sensitivePathMatch(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  for (const sensitive of SENSITIVE_LOCAL_PATHS) {
    const resolved = normalizePath(
      path.resolve(expandPath(sensitive.replace(/^~/, getHomeDir()))),
    );
    if (
      normalized === resolved ||
      normalized.startsWith(`${resolved}${path.sep}`)
    ) {
      return sensitive;
    }
  }
  return null;
}

function isEqualOrChild(filePath: string, parentPath: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedParent = normalizePath(parentPath);
  const relative = path.relative(normalizedParent, normalizedPath);
  return (
    relative === '' ||
    (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function normalizePath(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

function realpathIfExists(input: string): string {
  const resolved = path.resolve(input);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}
