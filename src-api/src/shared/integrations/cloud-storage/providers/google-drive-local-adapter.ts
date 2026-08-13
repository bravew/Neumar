import { getConnectionBroker } from '@/shared/auth/connection-broker';

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
} from '../types';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DEFAULT_DRIVE_FETCH_TIMEOUT_MS = 30_000;
const FILE_FIELDS =
  'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,parents,thumbnailLink,videoMediaMetadata,imageMediaMetadata,trashed';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
  thumbnailLink?: string;
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string;
  };
  imageMediaMetadata?: {
    width?: number;
    height?: number;
  };
  trashed?: boolean;
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

const CAPABILITIES: Capabilities = {
  fullTextSearch: true,
  thumbnails: true,
  exportContent: true,
  watch: false,
  longPoll: false,
  sharedDrives: false,
  mediaMetadata: {
    structuredSearch: false,
    writableFields: [],
  },
};

export class GoogleDriveLocalAdapter implements CloudStorageAdapter {
  readonly provider = 'google_drive' as const;

  getCapabilities(): Capabilities {
    return CAPABILITIES;
  }

  async listChildren(
    input: ListChildrenInput = {},
  ): Promise<ListResult<CloudFile>> {
    const params = new URLSearchParams({
      pageSize: String(input.limit ?? 50),
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: 'modifiedTime desc',
    });
    const parent = input.parentId;
    if (parent) {
      params.set('q', `'${escapeId(parent)}' in parents and trashed = false`);
    } else {
      params.set('q', "'root' in parents and trashed = false");
    }
    if (input.cursor) params.set('pageToken', input.cursor);
    const response = await this.fetchJson<DriveListResponse>(
      `/files?${params.toString()}`,
    );
    return mapList(response, input.limit ?? 50);
  }

  async search(input: SearchInput): Promise<ListResult<CloudFile>> {
    const params = new URLSearchParams({
      pageSize: String(input.limit ?? 50),
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: 'modifiedTime desc',
    });
    const queryParts: string[] = ['trashed = false'];
    const trimmedQuery = input.query?.trim();
    if (trimmedQuery) {
      const sanitized = trimmedQuery
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
      if (input.searchMode === 'filename') {
        queryParts.push(`name contains '${sanitized}'`);
      } else {
        queryParts.push(`fullText contains '${sanitized}'`);
      }
    }
    if (input.mediaKind === 'image') {
      queryParts.push("mimeType contains 'image/'");
    } else if (input.mediaKind === 'video') {
      queryParts.push("mimeType contains 'video/'");
    } else if (input.mediaKind === 'audio') {
      queryParts.push("mimeType contains 'audio/'");
    }
    if (input.media?.takenAfter) {
      queryParts.push(`modifiedTime >= '${input.media.takenAfter}'`);
    }
    if (input.media?.takenBefore) {
      queryParts.push(`modifiedTime <= '${input.media.takenBefore}'`);
    }
    params.set('q', queryParts.join(' and '));
    if (input.cursor) params.set('pageToken', input.cursor);
    const response = await this.fetchJson<DriveListResponse>(
      `/files?${params.toString()}`,
    );
    return mapList(response, input.limit ?? 50);
  }

  async getMetadata(providerItemId: string): Promise<CloudFile> {
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    const file = await this.fetchJson<DriveFile>(
      `/files/${encodeURIComponent(providerItemId)}?${params.toString()}`,
    );
    return driveFileToCloudFile(file);
  }

  async getThumbnail(providerItemId: string): Promise<Response> {
    const params = new URLSearchParams({ fields: 'thumbnailLink' });
    const file = await this.fetchJson<{ thumbnailLink?: string }>(
      `/files/${encodeURIComponent(providerItemId)}?${params.toString()}`,
    );
    const link = file.thumbnailLink;
    if (!link) {
      throw new CloudStorageError('unsupported', 'Drive item has no thumbnail');
    }
    const sized = link.includes('=s')
      ? link.replace(/=s\d+(-c)?(?=$|&)/, '=s400')
      : `${link}=s400`;
    const client = await getConnectionBroker().getServiceClient('google');
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DEFAULT_DRIVE_FETCH_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await client(sized, {
        method: 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new CloudStorageError(
        response.status === 404 ? 'not_found' : 'transient_upstream',
        `Drive thumbnail fetch failed (${response.status})`,
        { status: response.status },
      );
    }
    return response;
  }

  async download(
    providerItemId: string,
    init: DownloadInit = {},
  ): Promise<Response> {
    const meta = await this.getMetadata(providerItemId);
    if (meta.mimeType?.startsWith('application/vnd.google-apps.')) {
      const params = new URLSearchParams({ mimeType: 'application/pdf' });
      return this.fetchRaw(
        `/files/${encodeURIComponent(providerItemId)}/export?${params.toString()}`,
        { headers: init.range ? { Range: init.range } : {} },
      );
    }
    const params = new URLSearchParams({ alt: 'media' });
    return this.fetchRaw(
      `/files/${encodeURIComponent(providerItemId)}?${params.toString()}`,
      { headers: init.range ? { Range: init.range } : {} },
    );
  }

  async exportContent(_input: ExportInput): Promise<FileContent> {
    throw new CloudStorageError(
      'unsupported',
      'Use download() with a Range header for Drive content',
    );
  }

  createFolder(_parentId: string | null, _name: string): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Folder creation requires drive.file scope; not yet wired',
      ),
    );
  }

  upload(_input: UploadInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError('unsupported', 'Drive upload not yet wired'),
    );
  }

  updateMetadata(
    _providerItemId: string,
    _input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError(
        'unsupported',
        'Drive metadata updates not yet wired',
      ),
    );
  }

  move(_input: CopyMoveInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError('unsupported', 'Move not wired'),
    );
  }

  copy(_input: CopyMoveInput): Promise<CloudFile> {
    return Promise.reject(
      new CloudStorageError('unsupported', 'Copy not wired'),
    );
  }

  delete(_providerItemId: string, _permanent?: boolean): Promise<void> {
    return Promise.reject(
      new CloudStorageError('unsupported', 'Delete not wired'),
    );
  }

  getChanges(_input: ChangeCursorInput): Promise<ChangePage> {
    return Promise.reject(
      new CloudStorageError('unsupported', 'Drive change feed not yet wired'),
    );
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await this.fetchRaw(path);
    return (await response.json()) as T;
  }

  private async fetchRaw(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const client = await getConnectionBroker().getServiceClient('google');
    const controller = init.signal ? undefined : new AbortController();
    const timer = controller
      ? setTimeout(() => controller.abort(), DEFAULT_DRIVE_FETCH_TIMEOUT_MS)
      : undefined;
    let response: Response;
    try {
      response = await client(`${DRIVE_API}${path}`, {
        ...init,
        signal: init.signal ?? controller?.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      const text = await response.text();
      const code =
        response.status === 401
          ? 'auth_revoked'
          : response.status === 403
            ? 'permission_denied'
            : response.status === 404
              ? 'not_found'
              : 'transient_upstream';
      throw new CloudStorageError(
        code,
        `Drive API error ${response.status}: ${text.slice(0, 200)}`,
        { status: response.status },
      );
    }
    return response;
  }
}

function driveFileToCloudFile(file: DriveFile): CloudFile {
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  const sizeBytes = file.size ? Number(file.size) : 0;
  const dimensions = file.imageMediaMetadata ?? file.videoMediaMetadata;
  return {
    id: file.id,
    name: file.name,
    path: file.name,
    mimeType: file.mimeType,
    size: sizeBytes,
    createdAt: file.createdTime,
    modifiedAt: file.modifiedTime,
    parentId: file.parents?.[0] ?? null,
    isFolder,
    provider: 'google_drive',
    webUrl: file.webViewLink,
    thumbnailUrl: file.thumbnailLink
      ? `google-drive-thumbnail:${file.id}`
      : undefined,
    mediaMetadata:
      dimensions || file.videoMediaMetadata?.durationMillis
        ? {
            takenAt: file.createdTime,
            importedAt: file.createdTime,
            fileInfo: {
              width:
                dimensions && 'width' in dimensions
                  ? dimensions.width
                  : undefined,
              height:
                dimensions && 'height' in dimensions
                  ? dimensions.height
                  : undefined,
              durationSeconds: file.videoMediaMetadata?.durationMillis
                ? Number(file.videoMediaMetadata.durationMillis) / 1000
                : undefined,
            },
          }
        : undefined,
  };
}

function mapList(
  response: DriveListResponse,
  pageSize: number,
): ListResult<CloudFile> {
  const items = (response.files ?? []).map(driveFileToCloudFile);
  return {
    items,
    nextCursor: response.nextPageToken,
    hasMore: !!response.nextPageToken && items.length === pageSize,
  };
}

function escapeId(id: string): string {
  return id.replace(/'/g, "\\'");
}
