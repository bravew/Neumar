/**
 * Dropbox local cloud-storage adapter.
 *
 * Dropbox's HTTP API v2 is RPC-style: every operation is a POST to a
 * fixed endpoint with the request body in JSON (or, for content
 * endpoints, the raw bytes in the body and the metadata in a
 * `Dropbox-API-Arg` header). This adapter wraps that shape behind the
 * common CloudStorageAdapter interface so callers don't have to know
 * about the two host names or the header smuggling.
 *
 * Reference: https://www.dropbox.com/developers/documentation/http/documentation
 */
import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { mimeFromExtension as mimeFromMediaExtension } from '@/shared/utils/mime-extension';

import type { CloudStorageAdapter, DownloadInit } from '../adapter';
import { CloudStorageError, errorCodeFromStatus } from '../errors';
import { filterByMediaKind } from '../media-kind-filter';
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
} from '../types';

const DROPBOX_API = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_API = 'https://content.dropboxapi.com/2';

// Dropbox's /files/upload endpoint only handles files under 150 MB; anything
// larger must go through upload_session/start + append_v2 + finish. Dropbox
// recommends chunks in multiples of 4 MB.
//   https://developers.dropbox.com/dbx-performance-guide
const DROPBOX_SESSION_THRESHOLD_BYTES = 150 * 1024 * 1024;
const DROPBOX_SESSION_CHUNK_BYTES = 8 * 1024 * 1024;

const CAPABILITIES: Capabilities = {
  fullTextSearch: true,
  thumbnails: true,
  exportContent: false,
  watch: false,
  longPoll: true,
  sharedDrives: false,
  extractedTextRepresentation: false,
};

type DropboxTag = 'file' | 'folder' | 'deleted';

interface DropboxMetadata {
  '.tag': DropboxTag;
  id?: string;
  name: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
  client_modified?: string;
  server_modified?: string;
  rev?: string;
  content_hash?: string;
  is_downloadable?: boolean;
  sharing_info?: { url?: string; parent_shared_folder_id?: string };
}

interface DropboxListFolderResponse {
  entries: DropboxMetadata[];
  cursor: string;
  has_more: boolean;
}

interface DropboxSearchMatch {
  metadata: { metadata: DropboxMetadata };
}

interface DropboxSearchResponse {
  matches: DropboxSearchMatch[];
  has_more: boolean;
  cursor?: string;
}

export class DropboxLocalAdapter implements CloudStorageAdapter {
  readonly provider = 'dropbox' as const;

  getCapabilities(): Capabilities {
    return CAPABILITIES;
  }

  async listChildren(
    input: ListChildrenInput = {},
  ): Promise<ListResult<CloudFile>> {
    const response = input.cursor
      ? await this.rpc<DropboxListFolderResponse>(
          '/files/list_folder/continue',
          {
            cursor: input.cursor,
          },
        )
      : await this.rpc<DropboxListFolderResponse>('/files/list_folder', {
          path: pathOrIdFor(input.parentId),
          recursive: false,
          include_deleted: false,
          include_non_downloadable_files: true,
          limit: clampInt(input.limit, 1, 2000, 200),
        });
    return mapPage(response);
  }

  async search(input: SearchInput): Promise<ListResult<CloudFile>> {
    // Dropbox's SearchV2Arg requires a non-empty `query`; the spec's
    // SearchOptions.file_categories filter is only applied alongside a
    // query string. Without text, fall back to list_folder + client-side
    // filter so media-kind browsing works.
    const trimmedQuery = input.query?.trim() ?? '';
    if (!trimmedQuery) {
      const page = await this.listChildren({
        parentId: input.parentId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { ...page, items: filterByMediaKind(page.items, input.mediaKind) };
    }
    const body: Record<string, unknown> = {
      query: trimmedQuery,
      include_highlights: false,
      options: {
        max_results: clampInt(input.limit, 1, 1000, 100),
        ...(input.parentId ? { path: pathOrIdFor(input.parentId) } : {}),
        ...(input.mediaKind
          ? { file_categories: mapMediaKind(input.mediaKind) }
          : {}),
      },
    };
    if (input.cursor) body.cursor = input.cursor;
    const response = await this.rpc<DropboxSearchResponse>(
      input.cursor ? '/files/search/continue_v2' : '/files/search_v2',
      body,
    );
    const items = response.matches
      .map((m) => m.metadata.metadata)
      .filter((m) => m['.tag'] !== 'deleted')
      .map(dropboxMetadataToCloudFile);
    return {
      items,
      ...(response.has_more && response.cursor
        ? { nextCursor: response.cursor }
        : {}),
      hasMore: response.has_more,
    };
  }

  async getMetadata(providerItemId: string): Promise<CloudFile> {
    const meta = await this.rpc<DropboxMetadata>('/files/get_metadata', {
      path: pathOrIdFor(providerItemId),
      include_deleted: false,
    });
    return dropboxMetadataToCloudFile(meta);
  }

  async getThumbnail(providerItemId: string): Promise<Response> {
    return this.fetchRaw(`${DROPBOX_CONTENT_API}/files/get_thumbnail_v2`, {
      method: 'POST',
      headers: {
        'Dropbox-API-Arg': JSON.stringify({
          resource: {
            '.tag': 'path',
            path: pathOrIdFor(providerItemId),
          },
          format: { '.tag': 'png' },
          size: { '.tag': 'w256h256' },
          mode: { '.tag': 'strict' },
        }),
      },
    });
  }

  async download(
    providerItemId: string,
    init: DownloadInit = {},
  ): Promise<Response> {
    const headers = new Headers();
    headers.set(
      'Dropbox-API-Arg',
      JSON.stringify({ path: pathOrIdFor(providerItemId) }),
    );
    if (init.range) headers.set('Range', init.range);
    return this.fetchRaw(`${DROPBOX_CONTENT_API}/files/download`, {
      method: 'POST',
      headers,
      ...(init.signal ? { signal: init.signal } : {}),
    });
  }

  async exportContent(_input: ExportInput): Promise<FileContent> {
    throw new CloudStorageError(
      'unsupported',
      'Dropbox content is downloadable directly; use download()',
    );
  }

  async createFolder(
    parentId: string | null,
    name: string,
  ): Promise<CloudFile> {
    const parent = parentId ? pathOrIdFor(parentId) : '';
    const path = parent === '' ? `/${name}` : `${parent}/${name}`;
    const response = await this.rpc<{ metadata: DropboxMetadata }>(
      '/files/create_folder_v2',
      { path, autorename: false },
    );
    return dropboxMetadataToCloudFile(response.metadata);
  }

  async upload(input: UploadInput): Promise<CloudFile> {
    const parent = input.parentId ? pathOrIdFor(input.parentId) : '';
    const path = parent === '' ? `/${input.name}` : `${parent}/${input.name}`;
    const blob =
      input.content instanceof Blob
        ? input.content
        : new Blob([input.content as BlobPart], {
            type: input.mimeType ?? 'application/octet-stream',
          });
    const commit = {
      path,
      mode: input.overwrite ? { '.tag': 'overwrite' } : 'add',
      autorename: !input.overwrite,
      mute: true,
    };

    if (blob.size >= DROPBOX_SESSION_THRESHOLD_BYTES) {
      return this.uploadViaSession(blob, commit);
    }

    const meta = await this.fetchJson<DropboxMetadata>(
      `${DROPBOX_CONTENT_API}/files/upload`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify(commit),
        },
        body: await blob.arrayBuffer(),
      },
    );
    return dropboxMetadataToCloudFile(meta);
  }

  /**
   * Dropbox chunked upload using the upload-session API. Required for files
   * >= 150 MB. We stream the blob in 8 MB chunks (Dropbox recommends
   * multiples of 4 MB and caps per-request at 150 MB).
   *
   * Flow:
   *   1. POST /files/upload_session/start with first chunk → returns
   *      { session_id }.
   *   2. POST /files/upload_session/append_v2 with each subsequent chunk,
   *      passing cursor = { session_id, offset } where offset is the
   *      running byte count BEFORE the chunk.
   *   3. POST /files/upload_session/finish with the final chunk and the
   *      commit info (path, mode, …). Returns the file metadata.
   *
   * If a single chunk also happens to be the last (file size < chunk),
   * we still do start + finish (start with close=false then finish with
   * empty body and the running offset).
   */
  private async uploadViaSession(
    blob: Blob,
    commit: Record<string, unknown>,
  ): Promise<CloudFile> {
    const total = blob.size;
    let offset = 0;
    let sessionId = '';

    while (offset < total) {
      const end = Math.min(offset + DROPBOX_SESSION_CHUNK_BYTES, total);
      const chunk = blob.slice(offset, end);
      const body = await chunk.arrayBuffer();
      const isFirst = offset === 0;
      const isLast = end === total;

      if (isFirst && !isLast) {
        const start = await this.fetchJson<{ session_id: string }>(
          `${DROPBOX_CONTENT_API}/files/upload_session/start`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({ close: false }),
            },
            body,
          },
        );
        sessionId = start.session_id;
      } else if (isFirst && isLast) {
        // Edge case: file is below DROPBOX_SESSION_THRESHOLD_BYTES but the
        // caller still routed us here (e.g. tests). Use start with close=true
        // and then finish with the cursor at the end.
        const start = await this.fetchJson<{ session_id: string }>(
          `${DROPBOX_CONTENT_API}/files/upload_session/start`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({ close: true }),
            },
            body,
          },
        );
        sessionId = start.session_id;
        offset = end;
        break;
      } else if (!isLast) {
        await this.fetchRaw(
          `${DROPBOX_CONTENT_API}/files/upload_session/append_v2`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({
                cursor: { session_id: sessionId, offset },
                close: false,
              }),
            },
            body,
          },
        );
      } else {
        const meta = await this.fetchJson<DropboxMetadata>(
          `${DROPBOX_CONTENT_API}/files/upload_session/finish`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({
                cursor: { session_id: sessionId, offset },
                commit,
              }),
            },
            body,
          },
        );
        return dropboxMetadataToCloudFile(meta);
      }
      offset = end;
    }

    // Sub-threshold single-chunk path: finish with empty body at the
    // already-uploaded offset.
    const meta = await this.fetchJson<DropboxMetadata>(
      `${DROPBOX_CONTENT_API}/files/upload_session/finish`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            cursor: { session_id: sessionId, offset },
            commit,
          }),
        },
      },
    );
    return dropboxMetadataToCloudFile(meta);
  }

  async updateMetadata(
    providerItemId: string,
    input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    if (!input.name) return this.getMetadata(providerItemId);
    const meta = await this.getMetadata(providerItemId);
    const fromPath = meta.path ?? pathOrIdFor(providerItemId);
    const parentPath = parentDirectoryOf(fromPath);
    const toPath =
      parentPath === '' ? `/${input.name}` : `${parentPath}/${input.name}`;
    const response = await this.rpc<{ metadata: DropboxMetadata }>(
      '/files/move_v2',
      { from_path: fromPath, to_path: toPath, autorename: false },
    );
    return dropboxMetadataToCloudFile(response.metadata);
  }

  async move(input: CopyMoveInput): Promise<CloudFile> {
    const current = await this.getMetadata(input.providerItemId);
    const fromPath = current.path ?? pathOrIdFor(input.providerItemId);
    const parentPath = pathOrIdFor(input.newParentId);
    const name = input.newName ?? current.name;
    const toPath = parentPath === '' ? `/${name}` : `${parentPath}/${name}`;
    const response = await this.rpc<{ metadata: DropboxMetadata }>(
      '/files/move_v2',
      { from_path: fromPath, to_path: toPath, autorename: !input.overwrite },
    );
    return dropboxMetadataToCloudFile(response.metadata);
  }

  async copy(input: CopyMoveInput): Promise<CloudFile> {
    const current = await this.getMetadata(input.providerItemId);
    const fromPath = current.path ?? pathOrIdFor(input.providerItemId);
    const parentPath = pathOrIdFor(input.newParentId);
    const name = input.newName ?? current.name;
    const toPath = parentPath === '' ? `/${name}` : `${parentPath}/${name}`;
    const response = await this.rpc<{ metadata: DropboxMetadata }>(
      '/files/copy_v2',
      { from_path: fromPath, to_path: toPath, autorename: !input.overwrite },
    );
    return dropboxMetadataToCloudFile(response.metadata);
  }

  async delete(providerItemId: string, _permanent?: boolean): Promise<void> {
    await this.rpc('/files/delete_v2', { path: pathOrIdFor(providerItemId) });
  }

  async getChanges(input: ChangeCursorInput): Promise<ChangePage> {
    if (!input.cursor) {
      // Dropbox returns a starting cursor via /files/list_folder/get_latest_cursor
      // when called without a path; pass through the same shape.
      const init = await this.rpc<{ cursor: string }>(
        '/files/list_folder/get_latest_cursor',
        {
          path: input.rootId ? pathOrIdFor(input.rootId) : '',
          recursive: true,
          include_deleted: true,
        },
      );
      return { changes: [], nextCursor: init.cursor, hasMore: false };
    }
    const response = await this.rpc<DropboxListFolderResponse>(
      '/files/list_folder/continue',
      { cursor: input.cursor },
    );
    return {
      changes: response.entries.map((entry) => ({
        id: entry.id ?? entry.path_lower ?? entry.name,
        type: entry['.tag'] === 'deleted' ? 'deleted' : 'updated',
        itemId: entry.id ?? entry.path_lower ?? entry.name,
        item:
          entry['.tag'] === 'deleted'
            ? undefined
            : dropboxMetadataToCloudFile(entry),
      })),
      ...(response.cursor ? { nextCursor: response.cursor } : {}),
      hasMore: response.has_more,
    };
  }

  private async rpc<T>(path: string, body: unknown): Promise<T> {
    return this.fetchJson<T>(`${DROPBOX_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchRaw(url, init);
    return (await response.json()) as T;
  }

  private async fetchRaw(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const client = await getConnectionBroker().getServiceClient('dropbox');
    const response = await client(url, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CloudStorageError(
        errorCodeFromStatus(response.status),
        `Dropbox API error ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
        { status: response.status },
      );
    }
    return response;
  }
}

function mapPage(response: DropboxListFolderResponse): ListResult<CloudFile> {
  const items = response.entries
    .filter((e) => e['.tag'] !== 'deleted')
    .map(dropboxMetadataToCloudFile);
  return {
    items,
    ...(response.has_more ? { nextCursor: response.cursor } : {}),
    hasMore: response.has_more,
  };
}

function dropboxMetadataToCloudFile(meta: DropboxMetadata): CloudFile {
  const isFolder = meta['.tag'] === 'folder';
  const id = meta.id ?? meta.path_lower ?? meta.name;
  const mimeType = isFolder
    ? 'application/vnd.dropbox.folder'
    : (guessMime(meta.name) ?? 'application/octet-stream');
  return {
    id,
    name: meta.name,
    ...(meta.path_display ? { path: meta.path_display } : {}),
    mimeType,
    size: typeof meta.size === 'number' ? meta.size : 0,
    createdAt:
      meta.client_modified ?? meta.server_modified ?? new Date(0).toISOString(),
    modifiedAt:
      meta.server_modified ?? meta.client_modified ?? new Date(0).toISOString(),
    parentId: null, // Dropbox doesn't return parent id in metadata; derive from path if needed
    isFolder,
    provider: 'dropbox',
    // Frontend rewrites `dropbox-thumbnail:<id>` into the local proxy
    // URL. Folders skip the sentinel; non-thumbnailable file types just
    // 404 and the picker shows a file-icon placeholder.
    thumbnailUrl: isFolder ? undefined : `dropbox-thumbnail:${id}`,
    webUrl: meta.sharing_info?.url,
    revision: meta.rev,
    shared: meta.sharing_info != null,
  };
}

function pathOrIdFor(value: string | null | undefined): string {
  if (!value) return '';
  // Dropbox accepts paths ("/foo/bar") or id refs ("id:...") in any path arg.
  return value;
}

function parentDirectoryOf(pathOrId: string): string {
  if (pathOrId.startsWith('id:')) return '';
  const lastSlash = pathOrId.lastIndexOf('/');
  if (lastSlash <= 0) return '';
  return pathOrId.slice(0, lastSlash);
}

function mapMediaKind(kind: string): string[] {
  if (kind === 'image') return ['image'];
  if (kind === 'video') return ['video'];
  if (kind === 'audio') return ['audio'];
  if (kind === 'document') return ['document', 'pdf', 'paper'];
  return [];
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function guessMime(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  const media = mimeFromMediaExtension(ext);
  if (media) return media;
  const docs: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
  };
  return docs[ext];
}
