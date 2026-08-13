import type { CloudStorageAdapter } from './adapter';
import { CloudStorageError } from './errors';
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
} from './types';

const NO_CAPABILITIES: Capabilities = Object.freeze({
  fullTextSearch: false,
  thumbnails: false,
  exportContent: false,
  watch: false,
  longPoll: false,
  sharedDrives: false,
});

export class NoopProxyAdapter implements CloudStorageAdapter {
  constructor(readonly provider: CloudStorageProvider) {}

  getCapabilities(): Capabilities {
    return NO_CAPABILITIES;
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

  createFolder(_parentId: string | null, _name: string): Promise<CloudFile> {
    return unsupported();
  }

  upload(_input: UploadInput): Promise<CloudFile> {
    return unsupported();
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
}

function unsupported<T>(): Promise<T> {
  return Promise.reject(
    new CloudStorageError(
      'unsupported',
      'No provider implementation is registered in phase 1',
    ),
  );
}
