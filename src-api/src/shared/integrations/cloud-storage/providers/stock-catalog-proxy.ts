import type { SiteApiClient } from '@/shared/auth/site-api-client';

import { CloudStorageError } from '../errors';
import type {
  CloudStorageProvider,
  CloudFile,
  CopyMoveInput,
  UploadInput,
  MetadataUpdateInput,
} from '../types';
import { SiteProxyAdapter } from './site-proxy-adapter';

const STOCK_CAPABILITIES = Object.freeze({
  fullTextSearch: true,
  thumbnails: true,
  exportContent: false,
  watch: false,
  longPoll: false,
  sharedDrives: false,
  licenseInfo: {
    attributionRequired: true,
    downloadTrackingRequired: true,
  },
});

export type StockCatalogProvider = Extract<
  CloudStorageProvider,
  'openverse' | 'unsplash' | 'pexels' | 'pixabay' | 'coverr' | 'videvo'
>;

export const STOCK_CATALOG_PROVIDERS: readonly StockCatalogProvider[] = [
  'openverse',
  'unsplash',
  'pexels',
  'pixabay',
  'coverr',
  'videvo',
];

export class StockCatalogProxyAdapter extends SiteProxyAdapter {
  constructor(
    provider: StockCatalogProvider,
    connectionId: string,
    siteApiClient: SiteApiClient,
  ) {
    super(provider, connectionId, siteApiClient, STOCK_CAPABILITIES);
  }

  createFolder(_parentId: string | null, _name: string): Promise<CloudFile> {
    return readOnly();
  }

  upload(_input: UploadInput): Promise<CloudFile> {
    return readOnly();
  }

  updateMetadata(
    _providerItemId: string,
    _input: MetadataUpdateInput,
  ): Promise<CloudFile> {
    return readOnly();
  }

  move(_input: CopyMoveInput): Promise<CloudFile> {
    return readOnly();
  }

  copy(_input: CopyMoveInput): Promise<CloudFile> {
    return readOnly();
  }

  delete(_providerItemId: string, _permanent?: boolean): Promise<void> {
    return readOnly();
  }
}

function readOnly<T>(): Promise<T> {
  return Promise.reject(
    new CloudStorageError(
      'unsupported',
      'Stock catalog connections are read-only',
    ),
  );
}
