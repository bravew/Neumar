// Native cloud storage providers (Google Drive, Box, Dropbox, OneDrive) are
// served by in-process adapters that talk to the upstream API directly using
// OAuth tokens managed by the connection broker. They share a single
// well-known connection id per provider — there is no per-account cache row
// in `cloud_storage_connections_cache`, so callers that want to reach the
// adapter cannot go through `cloudStorageRegistry.resolve()`.
//
// This module centralizes the id ↔ provider mapping and adapter resolution
// so feature code (Assets remote search, cloud-storage routes, etc.) does
// not have to re-implement it.

import type { CloudStorageAdapter } from './adapter';
import { BoxLocalAdapter } from './providers/box-local-adapter';
import { DropboxLocalAdapter } from './providers/dropbox-local-adapter';
import { GoogleDriveLocalAdapter } from './providers/google-drive-local-adapter';
import { OneDriveLocalAdapter } from './providers/onedrive-local-adapter';
import type { CloudStorageProvider } from './types';

export const GOOGLE_DRIVE_LOCAL_ID = 'local_google_drive';
export const BOX_LOCAL_ID = 'local_box';
export const DROPBOX_LOCAL_ID = 'local_dropbox';
export const ONEDRIVE_LOCAL_ID = 'local_onedrive';

export type NativeCloudProvider =
  | 'google_drive'
  | 'box'
  | 'dropbox'
  | 'onedrive';

const PROVIDER_TO_ID: Record<NativeCloudProvider, string> = {
  google_drive: GOOGLE_DRIVE_LOCAL_ID,
  box: BOX_LOCAL_ID,
  dropbox: DROPBOX_LOCAL_ID,
  onedrive: ONEDRIVE_LOCAL_ID,
};

const ID_TO_PROVIDER = new Map<string, NativeCloudProvider>(
  Object.entries(PROVIDER_TO_ID).map(([provider, id]) => [
    id,
    provider as NativeCloudProvider,
  ]),
);

export function nativeLocalIdForProvider(
  provider: CloudStorageProvider,
): string | null {
  if (provider in PROVIDER_TO_ID) {
    return PROVIDER_TO_ID[provider as NativeCloudProvider];
  }
  return null;
}

export function nativeProviderForLocalId(
  id: string,
): NativeCloudProvider | null {
  return ID_TO_PROVIDER.get(id) ?? null;
}

export function isNativeLocalConnectionId(id: string): boolean {
  return ID_TO_PROVIDER.has(id);
}

export function resolveNativeLocalAdapter(
  connectionId: string,
): CloudStorageAdapter | null {
  switch (connectionId) {
    case GOOGLE_DRIVE_LOCAL_ID:
      return new GoogleDriveLocalAdapter();
    case BOX_LOCAL_ID:
      return new BoxLocalAdapter();
    case DROPBOX_LOCAL_ID:
      return new DropboxLocalAdapter();
    case ONEDRIVE_LOCAL_ID:
      return new OneDriveLocalAdapter();
    default:
      return null;
  }
}
