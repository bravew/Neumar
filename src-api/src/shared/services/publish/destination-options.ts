import {
  LocalPersonalMediaStore,
  type SiteConnection,
} from '@/shared/integrations/cloud-storage';

import { IMMICH_PUBLISH_CAPABILITIES } from './destinations/immich-destination';
import {
  publishDestinationRegistry,
  type PublishDestinationRegistry,
} from './registry';
import type { DestinationCapabilities, DestinationKind } from './types';

export interface PublishDestinationOption {
  kind: DestinationKind;
  connectionId: string;
  label?: string;
  capabilities: DestinationCapabilities;
}

interface ListPublishDestinationOptionsInput {
  registry?: PublishDestinationRegistry;
  listPersonalMediaConnections?: () => SiteConnection[];
}

const CONNECTION_SCOPED_KINDS = new Set<DestinationKind>(['immich']);

// Desktop-native cloud providers each have a single local connection
// owned by the local user. The connectionId surfaced here MUST match the
// id the corresponding `NativeCloudPublishDestination` accepts (see
// `destinations/native-cloud-destination.ts`) — otherwise publish jobs
// will fail with "requires connection id local_<x>".
const NATIVE_CLOUD_CONNECTION_IDS: Partial<Record<DestinationKind, string>> = {
  box: 'local_box',
  dropbox: 'local_dropbox',
  onedrive: 'local_onedrive',
};

const NATIVE_CLOUD_LABELS: Partial<Record<DestinationKind, string>> = {
  box: 'Box',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
};

export function listPublishDestinationOptions(
  input: ListPublishDestinationOptionsInput = {},
): PublishDestinationOption[] {
  const registry = input.registry ?? publishDestinationRegistry;
  const staticDestinations = registry
    .list()
    .filter((adapter) => !CONNECTION_SCOPED_KINDS.has(adapter.kind))
    .map((adapter) => ({
      kind: adapter.kind,
      connectionId: NATIVE_CLOUD_CONNECTION_IDS[adapter.kind] ?? adapter.kind,
      label: NATIVE_CLOUD_LABELS[adapter.kind],
      capabilities: adapter.capabilities(),
    }));

  return [
    ...staticDestinations,
    ...listImmichPublishDestinationOptions(input.listPersonalMediaConnections),
  ];
}

function listImmichPublishDestinationOptions(
  listPersonalMediaConnections = () =>
    new LocalPersonalMediaStore().listConnections(),
): PublishDestinationOption[] {
  return listPersonalMediaConnections()
    .filter(
      (connection) =>
        connection.provider === 'immich' &&
        connection.status !== 'needs_reauth',
    )
    .map((connection) => ({
      kind: 'immich' as const,
      connectionId: connection.id,
      label: connection.displayName ?? connection.display_name ?? 'Immich',
      capabilities: IMMICH_PUBLISH_CAPABILITIES,
    }));
}
