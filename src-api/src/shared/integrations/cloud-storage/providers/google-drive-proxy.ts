import type { SiteApiClient } from '@/shared/auth/site-api-client';

import type { CloudStorageAdapter, DownloadInit } from '../adapter';
import { CloudStorageError } from '../errors';
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
  WatchInput,
  WatchRegistration,
} from '../types';

export class GoogleDriveProxyAdapter implements CloudStorageAdapter {
  readonly provider = 'google_drive' as const;

  constructor(
    private readonly connectionId: string,
    private readonly siteApiClient: SiteApiClient,
  ) {}

  getCapabilities(): Capabilities {
    return {
      fullTextSearch: false,
      thumbnails: true,
      exportContent: true,
      watch: true,
      longPoll: false,
      sharedDrives: false,
    };
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
        cursor: input.cursor,
        limit: input.limit,
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
      this.path(`items/${encodeURIComponent(providerItemId)}`, {
        permanent,
      }),
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
      new CloudStorageError('unsupported', 'Drive watch is wired in phase 7'),
    );
  }

  private itemPath(providerItemId: string): string {
    return this.path(`items/${encodeURIComponent(providerItemId)}`);
  }

  private path(
    suffix: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return `/api/cloud-storage/connections/${this.connectionId}/${suffix}${
      qs ? `?${qs}` : ''
    }`;
  }
}
