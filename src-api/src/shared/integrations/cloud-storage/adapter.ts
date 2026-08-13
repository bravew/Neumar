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
  TimelineBucketsInput,
  TimelineBucketsResult,
  UploadInput,
  WatchInput,
  WatchRegistration,
} from './types';

export interface DownloadInit {
  range?: string;
  signal?: AbortSignal;
  /**
   * Request the untranscoded master file instead of a streaming-friendly
   * proxy. Materialization sets this: editing/rendering needs the original
   * bytes, and providers like Immich 500 on their transcoded
   * `/video/playback` endpoint when no transcode exists. Browser streaming
   * leaves it unset so it still gets the lighter playback variant.
   */
  preferOriginal?: boolean;
}

export interface RecordDownloadInit {
  trackingUrl?: string;
  signal?: AbortSignal;
}

export interface CloudStorageAdapter {
  readonly provider: CloudStorageProvider;

  getCapabilities(): Capabilities;
  listChildren(input?: ListChildrenInput): Promise<ListResult<CloudFile>>;
  search(input: SearchInput): Promise<ListResult<CloudFile>>;
  getMetadata(providerItemId: string): Promise<CloudFile>;
  getThumbnail?(providerItemId: string): Promise<Response>;
  download(providerItemId: string, init?: DownloadInit): Promise<Response>;
  recordDownload?(
    providerItemId: string,
    init?: RecordDownloadInit,
  ): Promise<void>;
  exportContent(input: ExportInput): Promise<FileContent>;
  createFolder(parentId: string | null, name: string): Promise<CloudFile>;
  upload(input: UploadInput): Promise<CloudFile>;
  updateMetadata(
    providerItemId: string,
    input: MetadataUpdateInput,
  ): Promise<CloudFile>;
  move(input: CopyMoveInput): Promise<CloudFile>;
  copy(input: CopyMoveInput): Promise<CloudFile>;
  delete(providerItemId: string, permanent?: boolean): Promise<void>;
  getChanges(input: ChangeCursorInput): Promise<ChangePage>;
  watch?(input: WatchInput): Promise<WatchRegistration>;
  getTimelineBuckets?(
    input?: TimelineBucketsInput,
  ): Promise<TimelineBucketsResult>;
}
