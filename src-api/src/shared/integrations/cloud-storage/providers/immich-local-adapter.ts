import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import type { SiteApiClient } from '@/shared/auth/site-api-client';
import { mimeFromExtension as mimeFromMediaExtension } from '@/shared/utils/mime-extension';

import type { DownloadInit } from '../adapter';
import { CloudStorageError, errorCodeFromStatus } from '../errors';
import {
  openBridgeResponse,
  normalizeImmichPrefix,
  PathMappingsStore,
  recordBridgeResolution,
  resolveBridgePath,
  type ImmichBridgeAsset,
  type PathMapping,
} from '../personal-media/lan-bridge';
import type {
  ChangeCursorInput,
  ChangePage,
  CloudFile,
  CopyMoveInput,
  FileContent,
  ListChildrenInput,
  ListResult,
  MetadataUpdateInput,
  SearchInput,
  TimelineBucketsInput,
  TimelineBucketsResult,
  UploadInput,
} from '../types';
import {
  PersonalMediaCredentialBroker,
  type PersonalMediaCredential,
  type PersonalMediaCredentialResolver,
} from './personal-media-credential-broker';
import { PersonalMediaProxyAdapter } from './personal-media-proxy';

type FetchLike = typeof fetch;

interface ImmichAsset {
  id: string;
  checksum?: string;
  isFavorite?: boolean;
  exifInfo?: {
    city?: string | null;
    country?: string | null;
    dateTimeOriginal?: string | null;
    description?: string | null;
    duration?: string | number | null;
    exposureTime?: string | number | null;
    exifImageHeight?: number | null;
    exifImageWidth?: number | null;
    fNumber?: number | string | null;
    fileSizeInByte?: number | string | null;
    focalLength?: number | string | null;
    iso?: number | string | null;
    latitude?: number | null;
    lensModel?: string | null;
    longitude?: number | null;
    make?: string | null;
    model?: string | null;
    rating?: number | null;
    state?: string | null;
  } | null;
  fileCreatedAt?: string;
  fileModifiedAt?: string;
  originalFileName?: string;
  originalMimeType?: string | null;
  originalPath?: string;
  people?: Array<{ id: string; name?: string }>;
  tags?: Array<{ id: string; name?: string; value?: string }>;
  type?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER';
  updatedAt?: string;
  createdAt?: string;
}

interface ImmichAlbum {
  id: string;
  albumName?: string;
  description?: string;
  assetCount?: number;
  albumThumbnailAssetId?: string;
  updatedAt?: string;
  createdAt?: string;
  assets?: ImmichAsset[];
}

interface ImmichSearchResponse {
  assets?: { count?: number; items?: ImmichAsset[] };
}

interface ImmichAssetPage {
  assets?: ImmichAsset[];
}

interface PathMappingsReader {
  list(connectionId: string, includeDisabled?: boolean): PathMapping[];
  markVerification?: (
    id: string,
    verified: boolean,
    options?: { verificationHash?: string; lastError?: string },
  ) => void;
}

const DEFAULT_IMMICH_FETCH_TIMEOUT_MS = 30_000;

export class ImmichLocalAdapter extends PersonalMediaProxyAdapter {
  constructor(
    private readonly immichConnectionId: string,
    siteApiClient: SiteApiClient,
    private readonly broker: PersonalMediaCredentialResolver = new PersonalMediaCredentialBroker(
      siteApiClient,
    ),
    private readonly bridgeMappings: PathMappingsReader = new PathMappingsStore(),
    private readonly fetchFn: FetchLike = fetch,
    private readonly fetchTimeoutMs: number = DEFAULT_IMMICH_FETCH_TIMEOUT_MS,
  ) {
    super('immich', immichConnectionId, siteApiClient, bridgeMappings);
  }

  private async getWebBaseUrl(): Promise<string> {
    const credential = await this.broker.resolve(this.immichConnectionId);
    return credential.baseUrl;
  }

  override async listChildren(
    input: ListChildrenInput = {},
  ): Promise<ListResult<CloudFile>> {
    const webBaseUrl = await this.getWebBaseUrl();
    if (input.parentId?.startsWith('album:')) {
      const album = await this.fetchJson<ImmichAlbum>(
        `/albums/${encodeURIComponent(input.parentId.slice('album:'.length))}`,
      );
      const assets = album.assets ?? [];
      return {
        items: assets.map((asset) => assetToCloudFile(asset, webBaseUrl)),
        totalCount: assets.length,
        hasMore: false,
      };
    }

    const page = await this.searchAssets({
      query: '',
      cursor: input.cursor,
      limit: input.limit,
    });
    if (input.cursor) return page;

    const albums = await this.fetchJson<ImmichAlbum[]>('/albums').catch(
      () => [],
    );
    return {
      ...page,
      items: [...albums.map(albumToCloudFile), ...page.items],
      totalCount: (page.totalCount ?? page.items.length) + albums.length,
    };
  }

  override search(input: SearchInput): Promise<ListResult<CloudFile>> {
    return this.searchAssets(input);
  }

  override async getMetadata(providerItemId: string): Promise<CloudFile> {
    if (providerItemId.startsWith('album:')) {
      const album = await this.fetchJson<ImmichAlbum>(
        `/albums/${encodeURIComponent(providerItemId.slice('album:'.length))}`,
      );
      return albumToCloudFile(album);
    }

    const webBaseUrl = await this.getWebBaseUrl();
    return assetToCloudFile(
      await this.fetchJson<ImmichAsset>(
        `/assets/${encodeURIComponent(providerItemId)}`,
      ),
      webBaseUrl,
    );
  }

  async getThumbnail(providerItemId: string): Promise<Response> {
    return this.fetchRaw(
      `/assets/${encodeURIComponent(providerItemId)}/thumbnail?format=WEBP`,
    );
  }

  override async download(
    providerItemId: string,
    init: DownloadInit = {},
  ): Promise<Response> {
    const metadata = await this.getMetadata(providerItemId);
    const isVideo = metadata.mimeType?.startsWith('video/') ?? false;
    // The transcoded `/video/playback` proxy is only worth fetching for
    // browser streaming. Materialization (`preferOriginal`) wants the master
    // file — and Immich 500s on `/video/playback` when a video has no
    // transcode, so routing originals through `/original` is both higher
    // fidelity and more reliable.
    const wantsOriginal = init.preferOriginal === true || !isVideo;

    if (wantsOriginal) {
      const asset = toBridgeAsset(metadata);
      if (asset) {
        const resolution = await resolveBridgePath({
          asset,
          mappings: this.bridgeMappings.list(this.immichConnectionId, false),
        });
        recordBridgeResolution(resolution, this.bridgeMappings);
        if (resolution.kind === 'local') {
          return openBridgeResponse(resolution, {
            range: init.range,
            contentType: metadata.mimeType,
          });
        }
      }
    }

    const upstreamPath = wantsOriginal
      ? `/assets/${encodeURIComponent(providerItemId)}/original`
      : `/assets/${encodeURIComponent(providerItemId)}/video/playback`;
    const headers: Record<string, string> = {};
    if (init.range) headers.Range = init.range;

    const response = await this.fetchRaw(upstreamPath, {
      headers,
      signal: init.signal,
    });
    return passthroughResponse(response);
  }

  override async exportContent(input: {
    providerItemId: string;
  }): Promise<FileContent> {
    const response = await this.fetchRaw(
      `/assets/${encodeURIComponent(input.providerItemId)}/original`,
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      fileId: input.providerItemId,
      content: buffer.toString('base64'),
      mimeType:
        response.headers.get('content-type') ?? 'application/octet-stream',
      size: buffer.length,
      isBase64: true,
    };
  }

  override async createFolder(
    _parentId: string | null,
    name: string,
  ): Promise<CloudFile> {
    return albumToCloudFile(
      await this.fetchJson<ImmichAlbum>('/albums', {
        method: 'POST',
        body: JSON.stringify({ albumName: name }),
      }),
    );
  }

  override async upload(input: UploadInput): Promise<CloudFile> {
    const mimeType = input.mimeType ?? 'application/octet-stream';
    const body = toBlob(input.content, mimeType);
    const now = new Date().toISOString();
    if (input.metadata?.writeMode === 'direct-then-scan') {
      return this.uploadDirectThenScan(input, body, mimeType, now);
    }

    const form = new FormData();
    form.set('assetData', body, input.name);
    form.set('deviceAssetId', `${input.name}-${body.size}-${now}`);
    form.set('deviceId', 'neuma-desktop');
    form.set('fileCreatedAt', input.metadata?.fileCreatedAt ?? now);
    form.set('fileModifiedAt', input.metadata?.fileModifiedAt ?? now);

    const upload = await this.fetchJson<{ id?: string }>('/assets', {
      method: 'POST',
      body: form,
    });
    if (!upload.id) {
      throw new CloudStorageError(
        'transient_upstream',
        'Immich upload response did not include an asset id',
      );
    }
    return this.getMetadata(upload.id);
  }

  private async uploadDirectThenScan(
    input: UploadInput,
    body: Blob,
    mimeType: string,
    now: string,
  ): Promise<CloudFile> {
    const libraryId = input.metadata?.libraryId;
    if (!libraryId) {
      throw new CloudStorageError(
        'unsupported',
        'Immich direct-then-scan upload requires metadata.libraryId',
      );
    }

    const mapping = selectDirectUploadMapping(
      this.bridgeMappings.list(this.immichConnectionId, false),
      input.metadata?.immichPathPrefix,
    );
    if (!mapping) {
      throw new CloudStorageError(
        'unsupported',
        'Immich direct-then-scan upload requires a verified LAN bridge mapping',
      );
    }

    const relativePath = normalizeRelativeUploadPath(
      input.metadata?.relativePath ?? input.name,
    );
    const targetPath = resolveMappedUploadPath(
      mapping.localMountPath,
      relativePath,
    );
    const bytes = Buffer.from(await body.arrayBuffer());
    await mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await writeFile(targetPath, bytes, {
        flag: input.overwrite ? 'w' : 'wx',
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CloudStorageError(
          'conflict',
          'Immich direct upload target already exists',
        );
      }
      throw new CloudStorageError(
        'permission_denied',
        'Immich direct upload could not write to the mapped path',
        { details: error instanceof Error ? error.message : String(error) },
      );
    }

    await this.fetchRaw(`/libraries/${encodeURIComponent(libraryId)}/scan`, {
      method: 'POST',
    });

    const originalPath = path.posix.join(
      normalizeImmichPrefix(mapping.immichPathPrefix),
      relativePath.split(path.sep).join('/'),
    );
    return {
      id: `pending-scan:${libraryId}:${relativePath}`,
      name: path.basename(relativePath),
      path: originalPath,
      mimeType,
      size: bytes.length,
      createdAt: input.metadata?.fileCreatedAt ?? now,
      modifiedAt: input.metadata?.fileModifiedAt ?? now,
      parentId: input.parentId,
      isFolder: false,
      provider: 'immich',
      mediaMetadata: {
        importedAt: now,
        fileInfo: {
          originalPath,
        },
      },
    };
  }

  override async updateMetadata(
    providerItemId: string,
    input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    const body: Record<string, unknown> = {};
    const metadata = input.metadata ?? {};
    if ('isFavorite' in metadata)
      body.isFavorite = metadata.isFavorite === 'true';
    if ('description' in metadata) body.description = metadata.description;
    if ('rating' in metadata) {
      const value = Number(metadata.rating);
      if (Number.isFinite(value)) body.rating = value;
    }
    if (input.name) body.originalFileName = input.name;
    await this.fetchJson(`/assets/${encodeURIComponent(providerItemId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return this.getMetadata(providerItemId);
  }

  override move(_input: CopyMoveInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Immich album membership is not exposed as move',
      ),
    );
  }

  override copy(_input: CopyMoveInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Immich assets cannot be copied through this adapter',
      ),
    );
  }

  override async delete(
    providerItemId: string,
    permanent = false,
  ): Promise<void> {
    await this.fetchJson('/assets', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [providerItemId], force: permanent }),
    });
  }

  async getTimelineBuckets(
    input: TimelineBucketsInput = {},
  ): Promise<TimelineBucketsResult> {
    const size = input.size ?? 'month';
    const params = new URLSearchParams({
      size: size === 'day' ? 'DAY' : 'MONTH',
    });
    if (input.isFavorite !== undefined) {
      params.set('isFavorite', String(input.isFavorite));
    }
    if (input.mediaKind === 'image') params.set('isVisible', 'true');
    const response = await this.fetchJson<
      Array<{ timeBucket?: string; date?: string; count: number }>
    >(`/timeline/buckets?${params.toString()}`);
    const buckets = response
      .map((bucket) => {
        const raw = bucket.timeBucket ?? bucket.date;
        if (!raw || typeof bucket.count !== 'number') return null;
        return {
          bucket: normalizeBucketKey(raw, size),
          count: bucket.count,
        };
      })
      .filter((value): value is { bucket: string; count: number } => !!value)
      .sort((a, b) => (a.bucket < b.bucket ? 1 : -1));
    return { size, buckets };
  }

  override async getChanges(input: ChangeCursorInput): Promise<ChangePage> {
    const cursor = parseChangeCursor(input.cursor);
    const limit = Math.min(input.limit ?? 100, 1000);
    const params = new URLSearchParams({
      updatedAfter: cursor.updatedAfter,
      take: String(limit),
      skip: String(cursor.skip),
    });
    const response = await this.fetchJson<ImmichAsset[] | ImmichAssetPage>(
      `/assets?${params.toString()}`,
    );
    const webBaseUrl = await this.getWebBaseUrl();
    const assets = Array.isArray(response)
      ? response
      : Array.isArray(response.assets)
        ? response.assets
        : [];
    const latestSeen = latestUpdatedAt(assets) ?? cursor.updatedAfter;
    const hasMore = assets.length === limit;
    return {
      changes: assets.map((asset) => ({
        id: `immich:${asset.id}:${asset.updatedAt ?? asset.fileModifiedAt ?? latestSeen}`,
        type: 'updated',
        itemId: asset.id,
        item: assetToCloudFile(asset, webBaseUrl),
        occurredAt: asset.updatedAt ?? asset.fileModifiedAt ?? latestSeen,
      })),
      nextCursor: encodeChangeCursor({
        updatedAfter: hasMore ? cursor.updatedAfter : latestSeen,
        skip: hasMore ? cursor.skip + assets.length : 0,
      }),
      hasMore,
      pacingHints: { defaultDelayMs: 30_000 },
    };
  }

  private async searchAssets(
    input: SearchInput,
  ): Promise<ListResult<CloudFile>> {
    const page = Number(input.cursor ?? 1);
    const size = Math.min(input.limit ?? 100, 1000);
    const mode = input.searchMode ?? (input.nameOnly ? 'filename' : 'context');
    const query = input.query?.trim() || undefined;

    const body: Record<string, unknown> = {
      page,
      size,
      withExif: true,
      withPeople: true,
      withStacked: false,
      country: input.place?.country,
      state: input.place?.state,
      city: input.place?.city,
      make: input.camera?.make,
      model: input.camera?.model,
      lensModel: input.camera?.lensModel,
      takenAfter: input.media?.takenAfter,
      takenBefore: input.media?.takenBefore,
      createdAfter: input.media?.importedAfter,
      createdBefore: input.media?.importedBefore,
      personIds: input.media?.personIds,
      tagIds: input.media?.tagIds,
      isFavorite: input.media?.isFavorite,
      isArchived: input.media?.isArchived,
      isNotInAlbum: input.media?.isInAlbum === false ? true : undefined,
      rating: input.media?.minRating,
      type:
        input.mediaKind === 'image'
          ? 'IMAGE'
          : input.mediaKind === 'video'
            ? 'VIDEO'
            : input.mediaKind === 'audio'
              ? 'AUDIO'
              : undefined,
    };

    let endpoint = '/search/metadata';
    if (query) {
      if (mode === 'filename') body.originalFileName = query;
      else if (mode === 'description') body.description = query;
      else if (mode === 'ocr') body.ocr = query;
      else {
        // Context (default) — use Immich's CLIP semantic search.
        endpoint = '/search/smart';
        body.query = query;
      }
    }

    const response = await this.fetchJson<ImmichSearchResponse>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const items = response.assets?.items ?? [];
    const webBaseUrl = await this.getWebBaseUrl();
    return {
      items: items.map((asset) => assetToCloudFile(asset, webBaseUrl)),
      totalCount: response.assets?.count,
      nextCursor: items.length === size ? String(page + 1) : undefined,
      hasMore: items.length === size,
    };
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchRaw(path, init);
    return (await response.json()) as T;
  }

  private async fetchRaw(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const credential = await this.broker.resolve(this.immichConnectionId);
    const controller = init.signal ? undefined : new AbortController();
    const timer = controller
      ? setTimeout(() => controller.abort(), this.fetchTimeoutMs)
      : undefined;
    let response: Response;
    try {
      response = await this.fetchFn(this.url(credential, path), {
        ...init,
        headers: this.headers(credential, init),
        redirect: 'manual',
        signal: init.signal ?? controller?.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new CloudStorageError(
        'permission_denied',
        'Immich redirect blocked by desktop personal-media policy',
        { status: 403 },
      );
    }
    if (!response.ok) {
      throw new CloudStorageError(
        errorCodeFromStatus(response.status),
        `Immich request failed with ${response.status}`,
        { status: response.status },
      );
    }
    return response;
  }

  private headers(
    credential: PersonalMediaCredential,
    init: RequestInit,
  ): Headers {
    const headers = new Headers(init.headers);
    headers.set('x-api-key', credential.apiKey);
    if (typeof init.body === 'string' && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return headers;
  }

  private url(credential: PersonalMediaCredential, path: string): URL {
    return new URL(path.replace(/^\//, ''), `${apiBase(credential.baseUrl)}/`);
  }
}

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
];

function normalizeBucketKey(raw: string, size: 'day' | 'month'): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (size === 'day') {
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return `${year}-${month}`;
}

function passthroughResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (!headers.has('accept-ranges')) {
    headers.set('accept-ranges', 'bytes');
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function assetToCloudFile(asset: ImmichAsset, webBaseUrl?: string): CloudFile {
  const exif = asset.exifInfo ?? undefined;
  const size = numberFromUnknown(exif?.fileSizeInByte) ?? 0;
  const durationSeconds = durationSecondsFromUnknown(exif?.duration);
  const createdAt = asset.fileCreatedAt ?? asset.createdAt ?? new Date();
  const modifiedAt = asset.fileModifiedAt ?? asset.updatedAt ?? createdAt;
  return {
    id: asset.id,
    name: asset.originalFileName?.trim() || `Immich asset ${asset.id}`,
    path: asset.originalPath ?? asset.id,
    mimeType:
      asset.originalMimeType ??
      mimeTypeFromKind(asset.type, asset.originalFileName),
    size,
    createdAt,
    modifiedAt,
    parentId: null,
    isFolder: false,
    provider: 'immich',
    thumbnailUrl: `immich-thumbnail:${asset.id}`,
    webUrl: webBaseUrl
      ? `${webBaseUrl.replace(/\/$/, '')}/photos/${asset.id}`
      : undefined,
    etag: asset.checksum,
    revision: asset.updatedAt,
    mediaMetadata: {
      takenAt: exif?.dateTimeOriginal ?? asset.fileCreatedAt ?? asset.createdAt,
      importedAt: asset.createdAt,
      geo:
        typeof exif?.latitude === 'number' && typeof exif.longitude === 'number'
          ? {
              latitude: exif.latitude,
              longitude: exif.longitude,
              city: exif.city ?? undefined,
              state: exif.state ?? undefined,
              country: exif.country ?? undefined,
            }
          : undefined,
      people: asset.people?.map((person) => ({
        id: person.id,
        name: person.name,
      })),
      tags: asset.tags?.map((tag) => ({
        id: tag.id,
        value: tag.value ?? tag.name ?? tag.id,
      })),
      description: exif?.description ?? undefined,
      rating: exif?.rating ?? undefined,
      isFavorite: asset.isFavorite,
      camera:
        exif?.make ||
        exif?.model ||
        exif?.lensModel ||
        exif?.focalLength ||
        exif?.fNumber ||
        exif?.iso ||
        exif?.exposureTime
          ? {
              make: exif.make ?? undefined,
              model: exif.model ?? undefined,
              lensModel: exif.lensModel ?? undefined,
              focalLengthMm: numberFromUnknown(exif.focalLength),
              apertureFNumber: numberFromUnknown(exif.fNumber),
              iso: numberFromUnknown(exif.iso),
              exposureSeconds: durationSecondsFromUnknown(exif.exposureTime),
            }
          : undefined,
      fileInfo: {
        checksum: asset.checksum,
        checksumAlgorithm: asset.checksum ? 'sha1' : undefined,
        originalPath: asset.originalPath,
        durationSeconds,
        width: exif?.exifImageWidth ?? undefined,
        height: exif?.exifImageHeight ?? undefined,
      },
    },
  };
}

function albumToCloudFile(album: ImmichAlbum): CloudFile {
  const createdAt = album.createdAt ?? new Date();
  const assetCount = album.assetCount ?? album.assets?.length ?? 0;
  return {
    id: `album:${album.id}`,
    name: album.albumName?.trim() || `Immich album ${album.id}`,
    path: `album:${album.id}`,
    mimeType: 'folder',
    // Folders have no meaningful byte size — keep `size` at 0 so generic
    // consumers don't misread it. The album's asset count is exposed on
    // the dedicated `itemCount` field instead.
    size: 0,
    itemCount: assetCount,
    createdAt,
    modifiedAt: album.updatedAt ?? createdAt,
    parentId: null,
    isFolder: true,
    provider: 'immich',
    thumbnailUrl: album.albumThumbnailAssetId
      ? `immich-thumbnail:${album.albumThumbnailAssetId}`
      : undefined,
    mediaMetadata: album.description
      ? { description: album.description }
      : undefined,
  };
}

function selectDirectUploadMapping(
  mappings: PathMapping[],
  requestedPrefix: string | undefined,
): PathMapping | null {
  const verified = mappings.filter(
    (mapping) => mapping.verified && !mapping.disabled,
  );
  if (!requestedPrefix) return verified[0] ?? null;

  const normalizedRequested = normalizeImmichPrefix(requestedPrefix);
  return (
    verified.find(
      (mapping) =>
        normalizeImmichPrefix(mapping.immichPathPrefix) === normalizedRequested,
    ) ?? null
  );
}

function normalizeRelativeUploadPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new CloudStorageError(
      'permission_denied',
      'Immich direct upload path must stay inside the mapped folder',
    );
  }
  return path.join(...segments);
}

function resolveMappedUploadPath(
  localMountPath: string,
  relativePath: string,
): string {
  const root = path.resolve(localMountPath);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new CloudStorageError(
      'permission_denied',
      'Immich direct upload path must stay inside the mapped folder',
    );
  }
  return target;
}

function toBridgeAsset(file: CloudFile): ImmichBridgeAsset | null {
  const originalPath = file.mediaMetadata?.fileInfo?.originalPath;
  if (!originalPath || file.size <= 0) return null;
  return {
    id: file.id,
    originalPath,
    fileSizeBytes: file.size,
    checksum: file.mediaMetadata?.fileInfo?.checksum ?? file.etag,
  };
}

function apiBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/api') ? pathname : `${pathname}/api`;
  return url.toString().replace(/\/+$/, '');
}

function mimeTypeFromKind(
  kind: ImmichAsset['type'],
  filename?: string,
): string {
  // Prefer the filename extension so a `.webm` capture or `.heic` photo isn't
  // mis-reported as `video/mp4` / `image/jpeg` when Immich's `originalMimeType`
  // is missing.
  const ext = filename ? filename.split('.').pop() : undefined;
  if (ext) {
    const guessed = mimeFromMediaExtension(ext);
    if (guessed) return guessed;
  }
  if (kind === 'VIDEO') return 'video/mp4';
  if (kind === 'AUDIO') return 'audio/mpeg';
  return 'image/jpeg';
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function durationSecondsFromUnknown(value: unknown): number | undefined {
  const numeric = numberFromUnknown(value);
  if (numeric !== undefined) return numeric;
  if (typeof value !== 'string') return undefined;

  const fraction = value.split('/');
  if (fraction.length === 2) {
    const numerator = Number(fraction[0]);
    const denominator = Number(fraction[1]);
    if (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator !== 0
    ) {
      return numerator / denominator;
    }
  }

  const parts = value.split(':').map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function toBlob(content: BodyInit, mimeType: string): Blob {
  if (content instanceof Blob) return content;
  if (typeof content === 'string') {
    return new Blob([content], { type: mimeType });
  }
  if (content instanceof ArrayBuffer) {
    return new Blob([content], { type: mimeType });
  }
  if (ArrayBuffer.isView(content)) {
    return new Blob([content], { type: mimeType });
  }
  throw new CloudStorageError(
    'unsupported',
    'Immich local upload requires Blob, string, ArrayBuffer, or typed array content',
  );
}

interface ImmichChangeCursor {
  updatedAfter: string;
  skip: number;
}

function parseChangeCursor(cursor: string | undefined): ImmichChangeCursor {
  if (!cursor) return { updatedAfter: new Date(0).toISOString(), skip: 0 };
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<ImmichChangeCursor>;
    if (
      typeof parsed.updatedAfter === 'string' &&
      Number.isFinite(Date.parse(parsed.updatedAfter))
    ) {
      return {
        updatedAfter: parsed.updatedAfter,
        skip:
          typeof parsed.skip === 'number' && parsed.skip > 0
            ? Math.floor(parsed.skip)
            : 0,
      };
    }
  } catch {
    // Legacy cursors were plain ISO timestamps.
  }
  if (Number.isFinite(Date.parse(cursor))) {
    return { updatedAfter: cursor, skip: 0 };
  }
  return { updatedAfter: new Date(0).toISOString(), skip: 0 };
}

function encodeChangeCursor(cursor: ImmichChangeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function latestUpdatedAt(assets: ImmichAsset[]): string | undefined {
  let latest: string | undefined;
  for (const asset of assets) {
    const candidate = asset.updatedAt ?? asset.fileModifiedAt;
    if (candidate && (!latest || Date.parse(candidate) > Date.parse(latest))) {
      latest = candidate;
    }
  }
  return latest;
}
