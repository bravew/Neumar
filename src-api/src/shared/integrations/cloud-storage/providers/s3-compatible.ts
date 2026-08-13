import type { CloudStorageAdapter } from '../adapter';
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

export interface S3CompatiblePutResult {
  key: string;
  etag?: string;
  versionId?: string;
  url?: string;
}

export interface S3CompatibleTransport {
  putObject(input: {
    key: string;
    body: BodyInit;
    contentType?: string;
    metadata?: Record<string, string>;
    overwrite?: boolean;
  }): Promise<S3CompatiblePutResult>;
  getBucketVersioning?(): Promise<{ enabled: boolean }>;
}

export interface S3CompatibleAdapterOptions {
  bucket: string;
  baseUrl?: string;
  transport: S3CompatibleTransport;
  versioningEnabled?: boolean;
  maxBytes?: number;
}

const S3_CAPABILITIES: Capabilities = Object.freeze({
  fullTextSearch: false,
  thumbnails: false,
  exportContent: false,
  watch: false,
  longPoll: false,
  sharedDrives: false,
});

export class S3CompatibleAdapter implements CloudStorageAdapter {
  readonly provider = 's3_compatible' as const;

  constructor(private readonly options: S3CompatibleAdapterOptions) {}

  getCapabilities(): Capabilities {
    return S3_CAPABILITIES;
  }

  async getPublishCapabilities(): Promise<{
    supportsVersioning: boolean;
    versioningEnabled: boolean;
    maxBytes?: number;
  }> {
    const discovered = await this.options.transport.getBucketVersioning?.();
    const versioningEnabled =
      discovered?.enabled ?? this.options.versioningEnabled ?? false;
    return {
      supportsVersioning: true,
      versioningEnabled,
      maxBytes: this.options.maxBytes,
    };
  }

  async upload(input: UploadInput): Promise<CloudFile> {
    const key = objectKey(input.parentId, input.name);
    const result = await this.options.transport.putObject({
      key,
      body: input.content,
      contentType: input.mimeType,
      metadata: input.metadata,
      overwrite: input.overwrite,
    });
    const now = new Date().toISOString();
    return {
      id: result.key,
      name: input.name,
      path: result.key,
      mimeType: input.mimeType ?? 'application/octet-stream',
      size: 0,
      createdAt: now,
      modifiedAt: now,
      parentId: input.parentId,
      isFolder: false,
      provider: this.provider,
      webUrl: result.url ?? this.objectUrl(result.key),
      etag: result.etag,
      revision: result.versionId ?? result.etag,
    };
  }

  listChildren(_input?: ListChildrenInput): Promise<ListResult<CloudFile>> {
    return unsupported();
  }

  search(_input: SearchInput): Promise<ListResult<CloudFile>> {
    return unsupported();
  }

  getMetadata(_providerItemId: string): Promise<CloudFile> {
    return unsupported();
  }

  download(_providerItemId: string): Promise<Response> {
    return unsupported();
  }

  exportContent(_input: ExportInput): Promise<FileContent> {
    return unsupported();
  }

  createFolder(parentId: string | null, name: string): Promise<CloudFile> {
    const now = new Date().toISOString();
    const key = objectKey(parentId, name).replace(/\/?$/, '/');
    return Promise.resolve({
      id: key,
      name,
      path: key,
      mimeType: 'application/x-directory',
      size: 0,
      createdAt: now,
      modifiedAt: now,
      parentId,
      isFolder: true,
      provider: this.provider,
    });
  }

  updateMetadata(
    _providerItemId: string,
    _input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    return unsupported();
  }

  move(_input: CopyMoveInput): Promise<CloudFile> {
    return unsupported();
  }

  copy(_input: CopyMoveInput): Promise<CloudFile> {
    return unsupported();
  }

  delete(_providerItemId: string, _permanent?: boolean): Promise<void> {
    return unsupported();
  }

  getChanges(_input: ChangeCursorInput): Promise<ChangePage> {
    return unsupported();
  }

  private objectUrl(key: string): string | undefined {
    if (!this.options.baseUrl) return undefined;
    return `${this.options.baseUrl.replace(/\/+$/g, '')}/${encodeURIComponent(
      key,
    )}`;
  }
}

function objectKey(parentId: string | null, name: string): string {
  const prefix = parentId ? `${parentId.replace(/\/+$/g, '')}/` : '';
  return `${prefix}${name.replace(/^\/+/g, '')}`;
}

function unsupported<T>(): Promise<T> {
  return Promise.reject(
    new CloudStorageError(
      'unsupported',
      'S3-compatible adapter only implements publish upload operations',
    ),
  );
}
