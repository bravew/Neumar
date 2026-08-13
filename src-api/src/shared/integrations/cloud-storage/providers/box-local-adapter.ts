/**
 * Box local cloud-storage adapter.
 *
 * Talks directly to the Box Content API v2 (`api.box.com/2.0`,
 * `upload.box.com/api/2.0`) using the OAuth access_token stored by
 * neuma's first-party OAuth client (no Composio in the path). The
 * connection broker handles refresh + revoke just like Google Drive.
 *
 * Reference: https://developer.box.com/reference/
 */
import { createHash } from 'node:crypto';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { mimeFromExtension as mimeFromMediaExtension } from '@/shared/utils/mime-extension';

import type { CloudStorageAdapter, DownloadInit } from '../adapter';
import { CloudStorageError, errorCodeFromStatus } from '../errors';
import {
  filterByMediaKind,
  MEDIA_KIND_EXTENSIONS,
  type MediaKind,
} from '../media-kind-filter';
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

const BOX_API = 'https://api.box.com/2.0';
const BOX_UPLOAD_API = 'https://upload.box.com/api/2.0';

// Box requires the chunked upload-session API for files >= 20 MB. The
// /files/content single-shot endpoint also has an implicit cap, so we use
// the session endpoint for anything at or above the threshold per
// https://developer.box.com/guides/uploads/chunked/.
const BOX_SESSION_THRESHOLD_BYTES = 20 * 1024 * 1024;

const FILE_FIELDS =
  'id,name,type,size,created_at,modified_at,parent,shared_link,etag,owned_by,extension,file_version';

const CAPABILITIES: Capabilities = {
  fullTextSearch: true,
  thumbnails: true,
  exportContent: false,
  watch: false,
  longPoll: false,
  sharedDrives: false,
  extractedTextRepresentation: true,
};

interface BoxItem {
  id: string;
  type: 'file' | 'folder' | 'web_link';
  name: string;
  size?: number;
  created_at?: string;
  modified_at?: string;
  parent?: { id?: string } | null;
  shared_link?: { url?: string } | null;
  etag?: string;
  owned_by?: { id?: string; name?: string; login?: string };
  extension?: string;
  file_version?: { sha1?: string };
}

interface BoxUploadSession {
  id: string;
  part_size: number;
  session_endpoints: {
    upload_part: string;
    commit: string;
    abort: string;
    list_parts: string;
    status: string;
    log_event: string;
  };
}

interface BoxUploadedPart {
  part_id: string;
  offset: number;
  size: number;
  sha1: string;
}

interface BoxListResponse {
  entries: BoxItem[];
  total_count?: number;
  offset?: number;
  limit?: number;
  next_marker?: string;
}

export class BoxLocalAdapter implements CloudStorageAdapter {
  readonly provider = 'box' as const;

  getCapabilities(): Capabilities {
    return CAPABILITIES;
  }

  async listChildren(
    input: ListChildrenInput = {},
  ): Promise<ListResult<CloudFile>> {
    const folderId = input.parentId ?? '0';
    const limit = clampInt(input.limit, 1, 1000, 100);
    const params = new URLSearchParams({
      fields: FILE_FIELDS,
      limit: String(limit),
      usemarker: 'true',
    });
    if (input.cursor) params.set('marker', input.cursor);
    const response = await this.fetchJson<BoxListResponse>(
      `${BOX_API}/folders/${encodeURIComponent(folderId)}/items?${params}`,
    );
    return mapList(response, limit);
  }

  async search(input: SearchInput): Promise<ListResult<CloudFile>> {
    // Box's GET /2.0/search returns 400 "missing_parameter" if `query` is
    // empty (the only filter-only alternative is `mdfilters`, which needs
    // metadata templates the user hasn't set up). When the user filters
    // by media kind without typing text, fall back to listing the current
    // folder and filtering by extension client-side — matches what Box's
    // own UI does in browse mode.
    const trimmedQuery = input.query?.trim() ?? '';
    if (!trimmedQuery) {
      const page = await this.listChildren({
        parentId: input.parentId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { ...page, items: filterByMediaKind(page.items, input.mediaKind) };
    }

    const limit = clampInt(input.limit, 1, 200, 100);
    const params = new URLSearchParams({
      query: trimmedQuery,
      scope: 'user_content',
      fields: FILE_FIELDS,
      limit: String(limit),
      offset: input.cursor ? input.cursor : '0',
    });
    if (input.parentId) params.set('ancestor_folder_ids', input.parentId);
    const fileExt = mediaKindToFileExtensions(input.mediaKind);
    if (fileExt) params.set('file_extensions', fileExt);
    const response = await this.fetchJson<BoxListResponse>(
      `${BOX_API}/search?${params}`,
    );
    return mapList(response, limit, params.get('offset') ?? undefined);
  }

  async getMetadata(providerItemId: string): Promise<CloudFile> {
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    const item = await this.fetchJson<BoxItem>(
      `${BOX_API}/files/${encodeURIComponent(providerItemId)}?${params}`,
    );
    return boxItemToCloudFile(item);
  }

  async getThumbnail(providerItemId: string): Promise<Response> {
    // Box renders different file types as different image formats:
    // images → jpg, documents (PDF/Office) → png. Try .png first; on
    // 404/415 ("no format available") retry with .jpg.
    //
    // Box also returns 202 while the thumbnail is being generated and
    // serves the bytes on a subsequent request. We poll briefly (up to
    // ~3s total) honouring the Retry-After hint so the picker actually
    // gets the image instead of a placeholder on first paint. Cap is
    // intentionally short — beyond that we 404 and let the picker show
    // its own file-icon fallback so a slow thumbnail can't stall the UI.
    const MAX_ATTEMPTS = 4;
    const DEFAULT_RETRY_MS = 800;
    const RETRY_CAP_MS = 1_500;

    const url = (ext: 'png' | 'jpg') =>
      `${BOX_API}/files/${encodeURIComponent(providerItemId)}/thumbnail.${ext}?min_width=256&min_height=256`;
    const client = await getConnectionBroker().getServiceClient('box');

    let ext: 'png' | 'jpg' = 'png';
    let response = await client(url(ext), { redirect: 'follow' });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (response.status === 200) return response;

      // Wrong format for this file type — switch extension and try again
      // without consuming an extra attempt.
      if (
        (response.status === 404 || response.status === 415) &&
        ext === 'png'
      ) {
        await response.arrayBuffer().catch(() => undefined);
        ext = 'jpg';
        response = await client(url(ext), { redirect: 'follow' });
        continue;
      }

      // Still generating — wait per Box's Retry-After (seconds) then poll.
      if (response.status === 202) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Math.min(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : DEFAULT_RETRY_MS,
          RETRY_CAP_MS,
        );
        await response.arrayBuffer().catch(() => undefined);
        await new Promise((r) => setTimeout(r, delay));
        response = await client(url(ext), { redirect: 'follow' });
        continue;
      }

      break;
    }

    if (response.ok) return response;

    if (response.status === 202) {
      await response.arrayBuffer().catch(() => undefined);
      throw new CloudStorageError(
        'not_found',
        'Box thumbnail still generating after retry budget',
        { status: 404 },
      );
    }

    const detail = await response.text().catch(() => '');
    throw new CloudStorageError(
      errorCodeFromStatus(response.status),
      `Box thumbnail error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      { status: response.status },
    );
  }

  async download(
    providerItemId: string,
    init: DownloadInit = {},
  ): Promise<Response> {
    const headers = new Headers();
    if (init.range) headers.set('Range', init.range);
    return this.fetchRaw(
      `${BOX_API}/files/${encodeURIComponent(providerItemId)}/content`,
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
      'Box does not require server-side export; use download() instead',
    );
  }

  async createFolder(
    parentId: string | null,
    name: string,
  ): Promise<CloudFile> {
    const item = await this.fetchJson<BoxItem>(`${BOX_API}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        parent: { id: parentId ?? '0' },
      }),
    });
    return boxItemToCloudFile(item);
  }

  async upload(input: UploadInput): Promise<CloudFile> {
    const blob =
      input.content instanceof Blob
        ? input.content
        : new Blob([input.content as BodyInit as BlobPart], {
            type: input.mimeType ?? 'application/octet-stream',
          });

    if (blob.size >= BOX_SESSION_THRESHOLD_BYTES) {
      return this.uploadViaSession(input, blob);
    }

    const form = new FormData();
    form.set(
      'attributes',
      JSON.stringify({
        name: input.name,
        parent: { id: input.parentId ?? '0' },
      }),
    );
    // Box requires the file blob to be the LAST part of the multipart body.
    form.set('file', blob, input.name);
    const response = await this.fetchJson<{ entries?: BoxItem[] }>(
      `${BOX_UPLOAD_API}/files/content`,
      { method: 'POST', body: form },
    );
    const entry = response.entries?.[0];
    if (!entry) {
      throw new CloudStorageError(
        'transient_upstream',
        'Box upload returned no entry',
      );
    }
    return boxItemToCloudFile(entry);
  }

  /**
   * Box chunked upload. Required for files >= 20 MB.
   *
   * 1. POST /files/upload_sessions → session with `part_size` and
   *    `session_endpoints` (upload_part, commit, abort).
   * 2. For each chunk, PUT to `upload_part` with
   *      content-range: bytes START-END/TOTAL
   *      digest: sha=<base64 SHA1 of chunk>
   *    Each chunk MUST be exactly `part_size` bytes, except the last.
   * 3. POST to `commit` with `digest: sha=<base64 SHA1 of whole file>`
   *    and body `{ parts: [{part_id, offset, size, sha1}] }`.
   *
   * Reference: https://developer.box.com/guides/uploads/chunked/
   */
  private async uploadViaSession(
    input: UploadInput,
    blob: Blob,
  ): Promise<CloudFile> {
    const session = await this.fetchJson<BoxUploadSession>(
      `${BOX_UPLOAD_API}/files/upload_sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_id: input.parentId ?? '0',
          file_size: blob.size,
          file_name: input.name,
        }),
      },
    );

    const partSize = session.part_size;
    const total = blob.size;
    const uploadPartUrl = session.session_endpoints.upload_part;
    const commitUrl = session.session_endpoints.commit;
    const abortUrl = session.session_endpoints.abort;
    const wholeFileSha = createHash('sha1');
    const parts: BoxUploadedPart[] = [];

    try {
      for (let offset = 0; offset < total; offset += partSize) {
        const end = Math.min(offset + partSize, total) - 1;
        const chunk = blob.slice(offset, end + 1);
        const buffer = new Uint8Array(await chunk.arrayBuffer());
        wholeFileSha.update(buffer);
        const chunkSha = createHash('sha1').update(buffer).digest('base64');
        const response = await this.fetchJson<{ part: BoxUploadedPart }>(
          uploadPartUrl,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Range': `bytes ${offset}-${end}/${total}`,
              Digest: `sha=${chunkSha}`,
            },
            body: buffer,
          },
        );
        parts.push(response.part);
      }
    } catch (err) {
      // Best-effort cleanup: tell Box to drop the half-finished session
      // so it doesn't linger for the 7-day session lifetime.
      await this.fetchRaw(abortUrl, { method: 'DELETE' }).catch(() => {});
      throw err;
    }

    const wholeDigest = wholeFileSha.digest('base64');
    const commitResponse = await this.fetchJson<{ entries?: BoxItem[] }>(
      commitUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Digest: `sha=${wholeDigest}`,
        },
        body: JSON.stringify({ parts }),
      },
    );
    const entry = commitResponse.entries?.[0];
    if (!entry) {
      throw new CloudStorageError(
        'transient_upstream',
        'Box upload-session commit returned no entry',
      );
    }
    return boxItemToCloudFile(entry);
  }

  async updateMetadata(
    providerItemId: string,
    input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    const body: Record<string, unknown> = {};
    if (input.name) body.name = input.name;
    if (Object.keys(body).length === 0) {
      return this.getMetadata(providerItemId);
    }
    const item = await this.fetchJson<BoxItem>(
      `${BOX_API}/files/${encodeURIComponent(providerItemId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return boxItemToCloudFile(item);
  }

  async move(input: CopyMoveInput): Promise<CloudFile> {
    const item = await this.fetchJson<BoxItem>(
      `${BOX_API}/files/${encodeURIComponent(input.providerItemId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: { id: input.newParentId },
          ...(input.newName ? { name: input.newName } : {}),
        }),
      },
    );
    return boxItemToCloudFile(item);
  }

  async copy(input: CopyMoveInput): Promise<CloudFile> {
    const item = await this.fetchJson<BoxItem>(
      `${BOX_API}/files/${encodeURIComponent(input.providerItemId)}/copy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: { id: input.newParentId },
          ...(input.newName ? { name: input.newName } : {}),
        }),
      },
    );
    return boxItemToCloudFile(item);
  }

  async delete(providerItemId: string, permanent?: boolean): Promise<void> {
    const params = permanent ? '?recursive=true' : '';
    await this.fetchRaw(
      `${BOX_API}/files/${encodeURIComponent(providerItemId)}${params}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Box change feed via the Events API
   * (https://developer.box.com/reference/get-events/). We use
   * `stream_type=changes`, which returns only content-changing user
   * events (create / upload / rename / move / trash / undo-trash /
   * modify) — `all` would pull in download/view noise.
   *
   * First call (no cursor): hit `?stream_position=now` to obtain a
   * starting cursor and return an empty change page. Subsequent calls
   * page forward from `next_stream_position`. Box uses a numeric cursor
   * we round-trip as a string to match the adapter interface.
   */
  async getChanges(input: ChangeCursorInput): Promise<ChangePage> {
    if (!input.cursor) {
      const init = await this.fetchJson<{
        next_stream_position: number | string;
      }>(`${BOX_API}/events?stream_position=now&stream_type=changes`);
      return {
        changes: [],
        nextCursor: String(init.next_stream_position),
        hasMore: false,
      };
    }
    const limit = clampInt(input.limit, 1, 500, 200);
    const params = new URLSearchParams({
      stream_type: 'changes',
      stream_position: input.cursor,
      limit: String(limit),
    });
    const response = await this.fetchJson<{
      chunk_size?: number;
      next_stream_position: number | string;
      entries?: BoxEvent[];
    }>(`${BOX_API}/events?${params}`);

    const changes = (response.entries ?? [])
      .map(boxEventToChangeEvent)
      .filter((c): c is NonNullable<ReturnType<typeof boxEventToChangeEvent>> =>
        Boolean(c),
      );
    const chunk = response.chunk_size ?? changes.length;
    return {
      changes,
      nextCursor: String(response.next_stream_position),
      hasMore: chunk >= limit,
      pacingHints: {
        // Box requests no more than once every 60s when idle; ~5s when
        // events are flowing. Surface both so the watch loop can adapt.
        defaultDelayMs: 60_000,
        retryAfterMs: 5_000,
      },
    };
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchRaw(url, init);
    return (await response.json()) as T;
  }

  private async fetchRaw(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const client = await getConnectionBroker().getServiceClient('box');
    const response = await client(url, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CloudStorageError(
        errorCodeFromStatus(response.status),
        `Box API error ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
        { status: response.status },
      );
    }
    return response;
  }
}

interface BoxEvent {
  event_id: string;
  event_type: string;
  created_at?: string;
  source?: BoxItem & { item_id?: string; item_type?: string };
}

function boxEventToChangeEvent(event: BoxEvent): {
  id: string;
  type: 'created' | 'updated' | 'deleted';
  itemId: string;
  item?: CloudFile;
  occurredAt?: string;
} | null {
  const itemId = event.source?.id ?? event.source?.item_id ?? event.event_id;
  const occurredAt = event.created_at;
  switch (event.event_type) {
    case 'ITEM_CREATE':
    case 'ITEM_UPLOAD':
    case 'ITEM_COPY':
    case 'ITEM_UNDELETE_VIA_TRASH':
      return {
        id: event.event_id,
        type: 'created',
        itemId,
        ...(event.source && event.source.id
          ? { item: boxItemToCloudFile(event.source) }
          : {}),
        ...(occurredAt ? { occurredAt } : {}),
      };
    case 'ITEM_RENAME':
    case 'ITEM_MOVE':
    case 'ITEM_MODIFY':
    case 'ITEM_SHARED':
    case 'ITEM_SHARED_CREATE':
    case 'ITEM_SHARED_UPDATE':
      return {
        id: event.event_id,
        type: 'updated',
        itemId,
        ...(event.source && event.source.id
          ? { item: boxItemToCloudFile(event.source) }
          : {}),
        ...(occurredAt ? { occurredAt } : {}),
      };
    case 'ITEM_TRASH':
      return {
        id: event.event_id,
        type: 'deleted',
        itemId,
        ...(occurredAt ? { occurredAt } : {}),
      };
    default:
      return null;
  }
}

function mapList(
  response: BoxListResponse,
  limit: number,
  fallbackOffset?: string,
): ListResult<CloudFile> {
  const items = (response.entries ?? []).map(boxItemToCloudFile);
  const nextCursor =
    response.next_marker ??
    (typeof response.total_count === 'number' && response.offset !== undefined
      ? response.offset + items.length < response.total_count
        ? String(response.offset + items.length)
        : undefined
      : fallbackOffset !== undefined && items.length >= limit
        ? String(Number(fallbackOffset) + items.length)
        : undefined);
  return {
    items,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    ...(response.total_count !== undefined
      ? { totalCount: response.total_count }
      : {}),
    hasMore: nextCursor !== undefined,
  };
}

function boxItemToCloudFile(item: BoxItem): CloudFile {
  const isFolder = item.type === 'folder';
  const mimeType = isFolder
    ? 'application/vnd.box.folder'
    : mimeFromExtension(item.extension) || 'application/octet-stream';
  return {
    id: item.id,
    name: item.name,
    mimeType,
    size: typeof item.size === 'number' ? item.size : 0,
    createdAt: item.created_at ?? new Date(0).toISOString(),
    modifiedAt: item.modified_at ?? new Date(0).toISOString(),
    parentId: item.parent?.id ?? null,
    isFolder,
    provider: 'box',
    webUrl: item.shared_link?.url,
    etag: item.etag,
    revision: item.file_version?.sha1,
    // Frontend rewrites `box-thumbnail:<id>` into the local proxy URL
    // `/cloud-storage/connections/<conn>/items/<id>/thumbnail`. Folders
    // and non-thumbnailable types (e.g. raw text) still get a sentinel
    // because the adapter handles 404 fallback gracefully — picker shows
    // the file-icon placeholder in that case.
    thumbnailUrl: isFolder ? undefined : `box-thumbnail:${item.id}`,
    owner: item.owned_by
      ? {
          ...(item.owned_by.id ? { id: item.owned_by.id } : {}),
          ...(item.owned_by.name ? { name: item.owned_by.name } : {}),
          ...(item.owned_by.login ? { email: item.owned_by.login } : {}),
        }
      : undefined,
    shared: item.shared_link != null,
  };
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

function mediaKindToFileExtensions(
  kind: string | undefined,
): string | undefined {
  if (!kind) return undefined;
  // Derive from the shared `MEDIA_KIND_EXTENSIONS` source so the Box
  // `file_extensions` API filter and the local `filterByMediaKind`
  // fallback can never drift apart.
  const set = MEDIA_KIND_EXTENSIONS[kind as MediaKind];
  if (!set) return undefined;
  return [...set].join(',');
}

function mimeFromExtension(ext: string | undefined): string | undefined {
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
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return docs[ext.toLowerCase()];
}
