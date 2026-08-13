/**
 * OneDrive local cloud-storage adapter.
 *
 * Microsoft Graph (`graph.microsoft.com/v1.0`) drives both personal
 * OneDrive and OneDrive for Business; the same shape addresses SharePoint
 * document libraries via `/drives/{driveId}`. The adapter defaults to
 * `/me/drive` (the signed-in user's default drive) but accepts an
 * optional `driveId` so callers can target a SharePoint library or a
 * shared team drive without subclassing.
 *
 * Large uploads go through a chunked **upload session** per Graph's
 * resumable spec:
 * https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession
 * Change feed uses `/delta` with `@odata.deltaLink` checkpointing per
 * https://learn.microsoft.com/en-us/graph/api/driveitem-delta
 */
import { getConnectionBroker } from '@/shared/auth/connection-broker';

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

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

/**
 * Microsoft Graph requires chunk sizes to be multiples of 320 KiB
 * (327,680 bytes) with a maximum of 60 MiB per chunk. 10 MiB lands in
 * the sweet spot recommended for general-purpose uploads: small enough
 * to retry cheaply on transient failure, large enough that overhead
 * doesn't dominate for multi-gigabyte files. 10 MiB = 32 × 320 KiB so
 * the alignment check is satisfied automatically.
 */
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;
const UPLOAD_SIMPLE_THRESHOLD_BYTES = 4 * 1024 * 1024;
const UPLOAD_CHUNK_MAX_RETRIES = 3;

const CAPABILITIES: Capabilities = {
  fullTextSearch: true,
  thumbnails: true,
  exportContent: false,
  watch: false,
  longPoll: false,
  sharedDrives: true,
  extractedTextRepresentation: false,
};

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  eTag?: string;
  cTag?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  parentReference?: { id?: string; path?: string; driveId?: string };
  file?: { mimeType?: string; hashes?: { sha1Hash?: string } };
  folder?: { childCount?: number };
  image?: { width?: number; height?: number };
  video?: { width?: number; height?: number; duration?: number };
  shared?: { scope?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

interface GraphListResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

interface GraphDrive {
  id: string;
  name?: string;
  driveType?: 'personal' | 'business' | 'documentLibrary';
  owner?: { user?: { displayName?: string; email?: string } };
  quota?: { total?: number; used?: number; remaining?: number };
}

interface UploadSessionResponse {
  uploadUrl: string;
  expirationDateTime: string;
  nextExpectedRanges?: string[];
}

export interface OneDriveLocalAdapterOptions {
  /**
   * Target a non-default drive. Omit for `/me/drive` (the signed-in
   * user's personal OneDrive). Pass a drive id resolved via
   * `listDrives()` or Graph `/me/drives` to target a SharePoint library
   * or team drive.
   */
  driveId?: string;
}

export class OneDriveLocalAdapter implements CloudStorageAdapter {
  readonly provider = 'onedrive' as const;
  private readonly driveId: string | undefined;

  constructor(options: OneDriveLocalAdapterOptions = {}) {
    this.driveId = options.driveId;
  }

  getCapabilities(): Capabilities {
    return CAPABILITIES;
  }

  /**
   * Discovery helper for SharePoint / team-drive scoping. Not part of
   * the standard CloudStorageAdapter surface — file pickers can call it
   * to build a drive selector before instantiating a scoped adapter.
   */
  async listDrives(): Promise<GraphDrive[]> {
    const response = await this.fetchJson<GraphListResponse<GraphDrive>>(
      `${GRAPH_API}/me/drives`,
    );
    return response.value;
  }

  async listChildren(
    input: ListChildrenInput = {},
  ): Promise<ListResult<CloudFile>> {
    const url = input.cursor
      ? input.cursor
      : `${GRAPH_API}${this.itemPath(input.parentId)}/children?$top=${clampInt(input.limit, 1, 200, 50)}`;
    const response =
      await this.fetchJson<GraphListResponse<GraphDriveItem>>(url);
    return mapList(response);
  }

  async search(input: SearchInput): Promise<ListResult<CloudFile>> {
    // Microsoft Graph's search(q='') requires a non-empty `q` and offers
    // no native mime-type filter. When the user filters by media kind
    // without typing text, fall back to listing children + client-side
    // extension filter so the picker still works.
    const trimmedQuery = input.query?.trim() ?? '';
    if (!trimmedQuery) {
      // Apply the fallback on every page — the previous `!input.cursor`
      // guard let pages 2+ slip through to the search path with an empty
      // query, returning unfiltered results. `listChildren` already
      // accepts the cursor and continues pagination correctly.
      const page = await this.listChildren({
        parentId: input.parentId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { ...page, items: filterByMediaKind(page.items, input.mediaKind) };
    }

    const top = clampInt(input.limit, 1, 200, 50);
    const url = input.cursor
      ? input.cursor
      : `${GRAPH_API}${this.driveBase()}/root/search(q='${encodeQuery(trimmedQuery)}')?$top=${top}`;
    const response =
      await this.fetchJson<GraphListResponse<GraphDriveItem>>(url);
    return mapList(response);
  }

  async getMetadata(providerItemId: string): Promise<CloudFile> {
    const item = await this.fetchJson<GraphDriveItem>(
      `${GRAPH_API}${this.driveBase()}/items/${encodeURIComponent(providerItemId)}`,
    );
    return graphItemToCloudFile(item);
  }

  async getThumbnail(providerItemId: string): Promise<Response> {
    return this.fetchRaw(
      `${GRAPH_API}${this.driveBase()}/items/${encodeURIComponent(providerItemId)}/thumbnails/0/medium/content`,
      { redirect: 'follow' },
    );
  }

  async download(
    providerItemId: string,
    init: DownloadInit = {},
  ): Promise<Response> {
    const headers = new Headers();
    if (init.range) headers.set('Range', init.range);
    return this.fetchRaw(
      `${GRAPH_API}${this.driveBase()}/items/${encodeURIComponent(providerItemId)}/content`,
      {
        headers,
        ...(init.signal ? { signal: init.signal } : {}),
        redirect: 'follow',
      },
    );
  }

  async exportContent(_input: ExportInput): Promise<FileContent> {
    throw new CloudStorageError(
      'unsupported',
      'OneDrive does not need server-side export; use download()',
    );
  }

  async createFolder(
    parentId: string | null,
    name: string,
  ): Promise<CloudFile> {
    const item = await this.fetchJson<GraphDriveItem>(
      `${GRAPH_API}${this.itemPath(parentId)}/children`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        }),
      },
    );
    return graphItemToCloudFile(item);
  }

  async upload(input: UploadInput): Promise<CloudFile> {
    const blob =
      input.content instanceof Blob
        ? input.content
        : new Blob([input.content as BlobPart], {
            type: input.mimeType ?? 'application/octet-stream',
          });
    const conflictBehavior = input.overwrite ? 'replace' : 'rename';

    // ≤ 4 MiB: single PUT to the simple-upload endpoint. Graph also
    // technically supports up to 250 MiB through this path on personal
    // accounts, but business accounts cap at 4 MiB. Always switch to a
    // session above 4 MiB for cross-tenant safety.
    if (blob.size <= UPLOAD_SIMPLE_THRESHOLD_BYTES) {
      const conflictQuery =
        conflictBehavior === 'rename'
          ? '?@microsoft.graph.conflictBehavior=rename'
          : '';
      const item = await this.fetchJson<GraphDriveItem>(
        `${GRAPH_API}${this.itemPath(input.parentId)}:/${encodeURIComponent(input.name)}:/content${conflictQuery}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': input.mimeType ?? 'application/octet-stream',
          },
          body: blob,
        },
      );
      return graphItemToCloudFile(item);
    }

    return this.uploadViaSession(input, blob, conflictBehavior);
  }

  async updateMetadata(
    providerItemId: string,
    input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    if (!input.name) return this.getMetadata(providerItemId);
    const item = await this.fetchJson<GraphDriveItem>(
      `${GRAPH_API}${this.driveBase()}/items/${encodeURIComponent(providerItemId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.name }),
      },
    );
    return graphItemToCloudFile(item);
  }

  async move(input: CopyMoveInput): Promise<CloudFile> {
    const body: Record<string, unknown> = {
      parentReference: { id: input.newParentId },
    };
    if (input.newName) body.name = input.newName;
    const item = await this.fetchJson<GraphDriveItem>(
      `${GRAPH_API}${this.driveBase()}/items/${encodeURIComponent(input.providerItemId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return graphItemToCloudFile(item);
  }

  async copy(input: CopyMoveInput): Promise<CloudFile> {
    // Copy is async on Graph: 202 Accepted with a Location header pointing
    // to a monitor URL. For now, return the source metadata as a stand-in
    // since the caller usually re-lists the target folder anyway.
    await this.fetchRaw(
      `${GRAPH_API}${this.driveBase()}/items/${encodeURIComponent(input.providerItemId)}/copy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentReference: { id: input.newParentId },
          ...(input.newName ? { name: input.newName } : {}),
        }),
      },
    );
    return this.getMetadata(input.providerItemId);
  }

  async delete(providerItemId: string, _permanent?: boolean): Promise<void> {
    await this.fetchRaw(
      `${GRAPH_API}${this.driveBase()}/items/${encodeURIComponent(providerItemId)}`,
      { method: 'DELETE' },
    );
  }

  async getChanges(input: ChangeCursorInput): Promise<ChangePage> {
    const url = input.cursor
      ? input.cursor
      : `${GRAPH_API}${this.driveBase()}/root/delta?$top=${clampInt(input.limit, 1, 500, 200)}`;
    const response =
      await this.fetchJson<GraphListResponse<GraphDriveItem>>(url);
    const changes = response.value.map((item) => ({
      id: item.id,
      type:
        item.id && (item as unknown as { deleted?: unknown }).deleted
          ? ('deleted' as const)
          : ('updated' as const),
      itemId: item.id,
      item: (item as unknown as { deleted?: unknown }).deleted
        ? undefined
        : graphItemToCloudFile(item),
    }));
    const next = response['@odata.nextLink'] ?? response['@odata.deltaLink'];
    return {
      changes,
      ...(next ? { nextCursor: next } : {}),
      hasMore: Boolean(response['@odata.nextLink']),
    };
  }

  // ---------------------------------------------------------------- internal

  private driveBase(): string {
    return this.driveId
      ? `/drives/${encodeURIComponent(this.driveId)}`
      : '/me/drive';
  }

  private itemPath(parentId: string | null | undefined): string {
    const base = this.driveBase();
    if (!parentId || parentId === 'root') return `${base}/root`;
    return `${base}/items/${encodeURIComponent(parentId)}`;
  }

  /**
   * Resumable upload via Graph's `createUploadSession` endpoint. The
   * session returns a pre-signed `uploadUrl` to which we PUT chunks
   * without any Authorization header (the URL itself carries auth).
   *
   * Resumability: on a 5xx or network failure we ask the upload URL for
   * `nextExpectedRanges` and resume from the first unfinished byte. On
   * a 416 (range out of bounds — usually a client/server clock skew or
   * duplicate chunk) we do the same. On 200/201 the final chunk returns
   * the created DriveItem.
   */
  private async uploadViaSession(
    input: UploadInput,
    blob: Blob,
    conflictBehavior: 'rename' | 'replace' | 'fail',
  ): Promise<CloudFile> {
    const session = await this.fetchJson<UploadSessionResponse>(
      `${GRAPH_API}${this.itemPath(input.parentId)}:/${encodeURIComponent(input.name)}:/createUploadSession`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': conflictBehavior,
            name: input.name,
          },
        }),
      },
    );

    const total = blob.size;
    let offset = 0;

    while (offset < total) {
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, total);
      const chunk = blob.slice(offset, end);
      const result = await this.putUploadChunk(
        session.uploadUrl,
        chunk,
        offset,
        end - 1,
        total,
      );

      if (result.kind === 'completed') {
        return graphItemToCloudFile(result.item);
      }
      if (result.kind === 'continue') {
        offset = end;
        continue;
      }
      // result.kind === 'resume' — server told us the next expected
      // range. Skip ahead (or back) to align with what the server has.
      offset = result.nextOffset;
    }

    // Loop exited without ever returning a completed item. Should not
    // happen on a well-formed Graph response but bail cleanly so callers
    // don't see a Promise<undefined>.
    throw new CloudStorageError(
      'transient_upstream',
      'OneDrive upload session ended without returning a DriveItem',
    );
  }

  private async putUploadChunk(
    uploadUrl: string,
    chunk: Blob,
    rangeStart: number,
    rangeEnd: number,
    total: number,
  ): Promise<
    | { kind: 'continue' }
    | { kind: 'completed'; item: GraphDriveItem }
    | { kind: 'resume'; nextOffset: number }
  > {
    let attempt = 0;
    let lastStatus = 0;
    while (attempt < UPLOAD_CHUNK_MAX_RETRIES) {
      let response: Response;
      try {
        // The uploadUrl is pre-signed by Graph; do NOT attach the
        // bearer token (the upload host rejects authenticated requests
        // and Microsoft's docs are explicit about this).
        response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${total}`,
            'Content-Length': String(rangeEnd - rangeStart + 1),
          },
          body: chunk,
        });
      } catch {
        attempt += 1;
        await sleep(backoffMs(attempt));
        continue;
      }
      lastStatus = response.status;
      if (response.status === 200 || response.status === 201) {
        const item = (await response.json()) as GraphDriveItem;
        return { kind: 'completed', item };
      }
      if (response.status === 202) {
        // Accepted — continue to next chunk. Drain the body so the
        // connection can be reused.
        await response.arrayBuffer().catch(() => undefined);
        return { kind: 'continue' };
      }
      if (response.status === 416) {
        const next = await this.resolveNextExpectedOffset(uploadUrl);
        if (next !== null) return { kind: 'resume', nextOffset: next };
      }
      if (response.status >= 500 && response.status < 600) {
        attempt += 1;
        await sleep(backoffMs(attempt));
        continue;
      }
      const detail = await response.text().catch(() => '');
      throw new CloudStorageError(
        errorCodeFromStatus(response.status),
        `OneDrive upload chunk failed (status=${response.status}${detail ? `, ${detail.slice(0, 200)}` : ''})`,
        { status: response.status },
      );
    }
    throw new CloudStorageError(
      'transient_upstream',
      `OneDrive upload chunk failed after ${UPLOAD_CHUNK_MAX_RETRIES} retries (lastStatus=${lastStatus})`,
    );
  }

  private async resolveNextExpectedOffset(
    uploadUrl: string,
  ): Promise<number | null> {
    try {
      const response = await fetch(uploadUrl, { method: 'GET' });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        nextExpectedRanges?: string[];
      };
      const first = body.nextExpectedRanges?.[0];
      if (!first) return null;
      const start = Number.parseInt(first.split('-')[0] ?? '0', 10);
      return Number.isFinite(start) ? start : null;
    } catch {
      return null;
    }
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchRaw(url, init);
    return (await response.json()) as T;
  }

  private async fetchRaw(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const client = await getConnectionBroker().getServiceClient('onedrive');
    const response = await client(url, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CloudStorageError(
        errorCodeFromStatus(response.status),
        `OneDrive API error ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
        { status: response.status },
      );
    }
    return response;
  }
}

function mapList(
  response: GraphListResponse<GraphDriveItem>,
): ListResult<CloudFile> {
  const items = response.value.map(graphItemToCloudFile);
  return {
    items,
    ...(response['@odata.nextLink']
      ? { nextCursor: response['@odata.nextLink'] }
      : {}),
    hasMore: Boolean(response['@odata.nextLink']),
  };
}

function graphItemToCloudFile(item: GraphDriveItem): CloudFile {
  const isFolder = item.folder !== undefined;
  const mimeType = isFolder
    ? 'application/vnd.microsoft.onedrive.folder'
    : (item.file?.mimeType ?? 'application/octet-stream');
  return {
    id: item.id,
    name: item.name,
    mimeType,
    size: typeof item.size === 'number' ? item.size : 0,
    createdAt: item.createdDateTime ?? new Date(0).toISOString(),
    modifiedAt: item.lastModifiedDateTime ?? new Date(0).toISOString(),
    parentId: item.parentReference?.id ?? null,
    isFolder,
    provider: 'onedrive',
    // Frontend rewrites `onedrive-thumbnail:<id>` into the local proxy
    // URL. Folders skip the sentinel; non-thumbnailable file types 404
    // and the picker shows a file-icon placeholder.
    thumbnailUrl: isFolder ? undefined : `onedrive-thumbnail:${item.id}`,
    webUrl: item.webUrl,
    etag: item.eTag,
    revision: item.cTag,
    shared: Boolean(item.shared),
    ...(item['@microsoft.graph.downloadUrl']
      ? {
          mediaMetadata: {
            fileInfo: {
              checksum: item.file?.hashes?.sha1Hash,
              checksumAlgorithm: 'sha1' as const,
              width: item.image?.width ?? item.video?.width,
              height: item.image?.height ?? item.video?.height,
              durationSeconds: item.video?.duration
                ? Math.round(item.video.duration / 1000)
                : undefined,
            },
          },
        }
      : {}),
  };
}

function encodeQuery(query: string): string {
  return encodeURIComponent(query.replace(/'/g, "''"));
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

function backoffMs(attempt: number): number {
  // Exponential with jitter: 500ms, 1s, 2s.
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
