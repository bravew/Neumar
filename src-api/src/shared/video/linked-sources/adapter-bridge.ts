import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import {
  cloudStorageRegistry,
  getCachedConnection,
} from '@/shared/integrations/cloud-storage';
import { BoxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/box-local-adapter';
import { DropboxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/dropbox-local-adapter';
import { GoogleDriveLocalAdapter } from '@/shared/integrations/cloud-storage/providers/google-drive-local-adapter';
import { OneDriveLocalAdapter } from '@/shared/integrations/cloud-storage/providers/onedrive-local-adapter';
import type { LinkedSource } from '@/shared/video/types';

import { LocalFsLinkedSourceAdapter } from './local-fs';

const LOCAL_CONNECTION_IDS = {
  'google-drive': 'local_google_drive',
  box: 'local_box',
  dropbox: 'local_dropbox',
  onedrive: 'local_onedrive',
} as const;

export function resolveLinkedSourceAdapter(
  source: LinkedSource,
): CloudStorageAdapter {
  if (source.provider === 'local-fs') {
    return new LocalFsLinkedSourceAdapter(source.rootPath);
  }

  const connectionId = source.connectionId;
  if (!connectionId) {
    throw new Error(`Linked source ${source.displayName} has no connection id`);
  }

  if (
    source.provider === 'google-drive' &&
    connectionId === LOCAL_CONNECTION_IDS['google-drive']
  ) {
    return new GoogleDriveLocalAdapter();
  }
  if (source.provider === 'box' && connectionId === LOCAL_CONNECTION_IDS.box) {
    return new BoxLocalAdapter();
  }
  if (
    source.provider === 'dropbox' &&
    connectionId === LOCAL_CONNECTION_IDS.dropbox
  ) {
    return new DropboxLocalAdapter();
  }
  if (
    source.provider === 'onedrive' &&
    connectionId === LOCAL_CONNECTION_IDS.onedrive
  ) {
    return new OneDriveLocalAdapter();
  }

  const cached = getCachedConnection(connectionId);
  if (!cached) {
    throw new Error(`Cloud storage connection not found: ${connectionId}`);
  }
  return cloudStorageRegistry.resolve(connectionId);
}

export function defaultConnectionIdForProvider(
  provider: LinkedSource['provider'],
): string | undefined {
  if (provider === 'google-drive') return LOCAL_CONNECTION_IDS['google-drive'];
  if (provider === 'box') return LOCAL_CONNECTION_IDS.box;
  if (provider === 'dropbox') return LOCAL_CONNECTION_IDS.dropbox;
  if (provider === 'onedrive') return LOCAL_CONNECTION_IDS.onedrive;
  return undefined;
}
