/**
 * Publish destination for the desktop-native cloud-storage providers
 * (Box, Dropbox, OneDrive). Each kind maps to a single local connection
 * id (`local_box`, `local_dropbox`, `local_onedrive`) and delegates the
 * actual upload to the matching `*LocalAdapter`, wrapped by the generic
 * `CloudStorageDestination`.
 *
 * The Immich publish destination uses the same wrap-per-leg pattern; we
 * follow it here so the per-kind registry entry stays stateless and the
 * cloud adapter is freshly constructed per leg (each adapter pulls a
 * fresh OAuth bearer at call time via the token manager).
 */
import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import { BoxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/box-local-adapter';
import { DropboxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/dropbox-local-adapter';
import { OneDriveLocalAdapter } from '@/shared/integrations/cloud-storage/providers/onedrive-local-adapter';

import type {
  DestinationCapabilities,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  UploadHandle,
  VersioningPolicy,
  LegContext,
} from '../types';
import { CloudStorageDestination } from './cloud-storage-destination';

type NativeCloudKind = 'box' | 'dropbox' | 'onedrive';

const NATIVE_CLOUD_CAPABILITIES: DestinationCapabilities = {
  supportsResumable: true,
  supportsVersioning: false,
  requiresReformat: false,
  acceptedMimePrefixes: ['image/', 'video/', 'audio/', 'application/', 'text/'],
  approvalDefault: false,
};

const NATIVE_CLOUD_VERSIONING: VersioningPolicy = {
  mode: 'content-addressable',
};

const KIND_TO_LOCAL_CONNECTION_ID: Record<NativeCloudKind, string> = {
  box: 'local_box',
  dropbox: 'local_dropbox',
  onedrive: 'local_onedrive',
};

function createAdapterForKind(kind: NativeCloudKind): CloudStorageAdapter {
  switch (kind) {
    case 'box':
      return new BoxLocalAdapter();
    case 'dropbox':
      return new DropboxLocalAdapter();
    case 'onedrive':
      return new OneDriveLocalAdapter();
  }
}

export interface NativeCloudPublishDestinationOptions {
  kind: NativeCloudKind;
  resolveAdapter?: () => CloudStorageAdapter;
}

export class NativeCloudPublishDestination implements PublishDestinationAdapter {
  readonly kind: NativeCloudKind;

  private readonly resolveAdapter: () => CloudStorageAdapter;
  private readonly expectedConnectionId: string;

  constructor(options: NativeCloudPublishDestinationOptions) {
    this.kind = options.kind;
    this.expectedConnectionId = KIND_TO_LOCAL_CONNECTION_ID[options.kind];
    this.resolveAdapter =
      options.resolveAdapter ?? (() => createAdapterForKind(options.kind));
  }

  capabilities(): DestinationCapabilities {
    return NATIVE_CLOUD_CAPABILITIES;
  }

  plan(input: PublishLegInput): Promise<PublishLegPlan> {
    return this.destinationFor(input).plan(input);
  }

  upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    return this.destinationFor(input).upload(input, ctx);
  }

  async finalize(handle: UploadHandle): Promise<PublishedRef> {
    if (handle.providerState?.alreadyCurrent) {
      return {
        providerId: handle.providerState.targetRef as string,
        metadata: {
          note: 'already-current',
          targetPath: handle.providerState.targetPath,
        },
      };
    }
    const ref = handle.providerState?.ref;
    if (isPublishedRef(ref)) return ref;
    throw new Error(
      `${this.kind} publish did not return an uploaded asset ref`,
    );
  }

  queryStatus(): Promise<PublishedStatus> {
    return Promise.resolve({ state: 'available' });
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }

  private destinationFor(input: PublishLegInput): CloudStorageDestination {
    const connectionId = input.destination.connectionId;
    // For the desktop-native providers there is exactly one local
    // connection per kind, owned by the local user. Reject anything else
    // so we never accidentally route a publish to the wrong account.
    if (connectionId !== this.expectedConnectionId) {
      throw new Error(
        `${this.kind} publish requires connection id "${this.expectedConnectionId}", got "${connectionId}"`,
      );
    }
    return new CloudStorageDestination({
      kind: this.kind,
      connectionId,
      adapter: this.resolveAdapter(),
      defaultVersioning: NATIVE_CLOUD_VERSIONING,
      capabilities: NATIVE_CLOUD_CAPABILITIES,
    });
  }
}

function isPublishedRef(value: unknown): value is PublishedRef {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { providerId?: unknown }).providerId === 'string'
  );
}
