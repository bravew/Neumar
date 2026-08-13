export * from './adapter';
export * from './bootstrap';
export * from './cache';
export * from './content';
export * from './errors';
export * from './media-kind-filter';
export * from './noop-proxy-adapter';
export * from './observability';
export * from './personal-media';
export * from './personal-media/local-personal-media-store';
export * from './providers/box-proxy';
export * from './providers/dropbox-proxy';
export * from './providers/google-drive-proxy';
export * from './providers/immich-local-adapter';
export * from './providers/onedrive-proxy';
export * from './providers/personal-media-credential-broker';
export * from './providers/personal-media-proxy';
export * from './providers/site-proxy-adapter';
export * from './providers/s3-compatible';
export * from './providers/stock-catalog-proxy';
export * from './native-local';
export * from './registry';
export * from './types';
export * from './watch';

import { BoxProxyAdapter } from './providers/box-proxy';
import { DropboxProxyAdapter } from './providers/dropbox-proxy';
import { GoogleDriveProxyAdapter } from './providers/google-drive-proxy';
import { ImmichLocalAdapter } from './providers/immich-local-adapter';
import { OneDriveProxyAdapter } from './providers/onedrive-proxy';
import { PersonalMediaProxyAdapter } from './providers/personal-media-proxy';
import { StockCatalogProxyAdapter } from './providers/stock-catalog-proxy';
import { cloudStorageRegistry } from './registry';

cloudStorageRegistry.register(
  'google_drive',
  ({ connectionId, siteApiClient }) =>
    new GoogleDriveProxyAdapter(connectionId, siteApiClient),
);
cloudStorageRegistry.register(
  'dropbox',
  ({ connectionId, siteApiClient }) =>
    new DropboxProxyAdapter(connectionId, siteApiClient),
);
cloudStorageRegistry.register(
  'box',
  ({ connectionId, siteApiClient }) =>
    new BoxProxyAdapter(connectionId, siteApiClient),
);
cloudStorageRegistry.register(
  'onedrive',
  ({ connectionId, siteApiClient }) =>
    new OneDriveProxyAdapter(connectionId, siteApiClient),
);
import { STOCK_CATALOG_PROVIDERS } from './providers/stock-catalog-proxy';

for (const provider of STOCK_CATALOG_PROVIDERS) {
  cloudStorageRegistry.register(
    provider,
    ({ connectionId, siteApiClient }) =>
      new StockCatalogProxyAdapter(provider, connectionId, siteApiClient),
  );
}
cloudStorageRegistry.register(
  'immich',
  ({ connectionId, siteApiClient }) =>
    new ImmichLocalAdapter(connectionId, siteApiClient),
);
cloudStorageRegistry.register(
  'photoprism',
  ({ connectionId, siteApiClient }) =>
    new PersonalMediaProxyAdapter('photoprism', connectionId, siteApiClient),
);
