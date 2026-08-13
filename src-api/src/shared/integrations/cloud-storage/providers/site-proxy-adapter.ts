import type { SiteApiClient } from '@/shared/auth/site-api-client';

import type {
  CloudStorageAdapter,
  DownloadInit,
  RecordDownloadInit,
} from '../adapter';
import { CloudStorageError } from '../errors';
import type {
  Capabilities,
  ChangeCursorInput,
  ChangePage,
  CloudFile,
  CloudStorageProvider,
  CopyMoveInput,
  ExportInput,
  FileContent,
  ListChildrenInput,
  ListResult,
  MetadataUpdateInput,
  SearchInput,
  UploadInput,
  WatchInput,
  WatchRegistration,
} from '../types';

export class SiteProxyAdapter implements CloudStorageAdapter {
  constructor(
    readonly provider: CloudStorageProvider,
    private readonly connectionId: string,
    private readonly siteApiClient: SiteApiClient,
    private readonly capabilities: Capabilities,
  ) {}

  getCapabilities(): Capabilities {
    return this.capabilities;
  }

  listChildren(input: ListChildrenInput = {}): Promise<ListResult<CloudFile>> {
    return this.siteApiClient.getJson(
      this.path('items', {
        parentId: input.parentId ?? undefined,
        cursor: input.cursor,
        limit: input.limit,
      }),
    );
  }

  search(input: SearchInput): Promise<ListResult<CloudFile>> {
    return this.siteApiClient.getJson(
      this.path('search', {
        q: input.query,
        parentId: input.parentId ?? undefined,
        cursor: input.cursor,
        limit: input.limit,
        media_kind: input.mediaKind,
        license_filter: input.licenseFilter,
        orientation: input.orientation,
        color_palette: input.colorPalette,
        min_width: input.minDimensions?.width,
        min_height: input.minDimensions?.height,
        taken_after: input.media?.takenAfter,
        taken_before: input.media?.takenBefore,
        imported_after: input.media?.importedAfter,
        imported_before: input.media?.importedBefore,
        person_ids: input.media?.personIds,
        tag_ids: input.media?.tagIds,
        is_favorite: input.media?.isFavorite,
        min_rating: input.media?.minRating,
        geo_north: input.media?.geoBounds?.north,
        geo_south: input.media?.geoBounds?.south,
        geo_east: input.media?.geoBounds?.east,
        geo_west: input.media?.geoBounds?.west,
      }),
    );
  }

  getMetadata(providerItemId: string): Promise<CloudFile> {
    return this.siteApiClient.getJson(this.itemPath(providerItemId));
  }

  download(providerItemId: string, init: DownloadInit = {}): Promise<Response> {
    const headers = new Headers();
    if (init.range) headers.set('Range', init.range);
    return this.siteApiClient.streamGetResponse(
      `${this.itemPath(providerItemId)}/content`,
      { headers, signal: init.signal },
    );
  }

  async recordDownload(
    providerItemId: string,
    init: RecordDownloadInit = {},
  ): Promise<void> {
    await this.siteApiClient.postJson(
      `${this.itemPath(providerItemId)}/download-tracking`,
      { trackingUrl: init.trackingUrl },
      { signal: init.signal },
    );
  }

  exportContent(input: ExportInput): Promise<FileContent> {
    return this.siteApiClient.getJson(
      `${this.itemPath(input.providerItemId)}/content?export=1${
        input.mimeType ? `&mimeType=${encodeURIComponent(input.mimeType)}` : ''
      }`,
    );
  }

  createFolder(parentId: string | null, name: string): Promise<CloudFile> {
    return this.siteApiClient.postJson(this.path('items'), {
      kind: 'folder',
      parentId,
      name,
    });
  }

  upload(input: UploadInput): Promise<CloudFile> {
    const form = new FormData();
    form.set('parentId', input.parentId ?? '');
    form.set('name', input.name);
    if (input.mimeType) form.set('mimeType', input.mimeType);
    if (input.overwrite !== undefined) {
      form.set('overwrite', String(input.overwrite));
    }
    if (input.metadata) form.set('metadata', JSON.stringify(input.metadata));
    form.set('file', input.content as Blob);
    return this.siteApiClient.putForm(this.path('items'), form);
  }

  updateMetadata(
    providerItemId: string,
    input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    return this.siteApiClient.patchJson(this.itemPath(providerItemId), input);
  }

  move(input: CopyMoveInput): Promise<CloudFile> {
    return this.siteApiClient.postJson(
      `${this.itemPath(input.providerItemId)}/move`,
      input,
    );
  }

  copy(input: CopyMoveInput): Promise<CloudFile> {
    return this.siteApiClient.postJson(
      `${this.itemPath(input.providerItemId)}/copy`,
      input,
    );
  }

  async delete(providerItemId: string, permanent?: boolean): Promise<void> {
    await this.siteApiClient.del(
      this.path(`items/${encodeURIComponent(providerItemId)}`, { permanent }),
    );
  }

  getChanges(input: ChangeCursorInput): Promise<ChangePage> {
    return this.siteApiClient.getJson(
      this.path('changes', {
        cursor: input.cursor,
        limit: input.limit,
        rootId: input.rootId ?? undefined,
      }),
    );
  }

  watch(_input: WatchInput): Promise<WatchRegistration> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Provider watch is wired in phase 7',
      ),
    );
  }

  private itemPath(providerItemId: string): string {
    return this.path(`items/${encodeURIComponent(providerItemId)}`);
  }

  private path(
    suffix: string,
    query?: Record<
      string,
      string | number | boolean | Array<string | number | boolean> | undefined
    >,
  ): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          params.append(key, String(item));
        }
      } else {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return `/api/cloud-storage/connections/${this.connectionId}/${suffix}${
      qs ? `?${qs}` : ''
    }`;
  }
}
