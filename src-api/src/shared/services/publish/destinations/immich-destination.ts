import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import {
  cloudStorageRegistry,
  LocalPersonalMediaStore,
} from '@/shared/integrations/cloud-storage';

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

export const IMMICH_PUBLISH_CAPABILITIES: DestinationCapabilities = {
  supportsResumable: false,
  supportsVersioning: false,
  requiresReformat: false,
  acceptedMimePrefixes: ['image/', 'video/'],
  approvalDefault: false,
};

const IMMICH_DEFAULT_VERSIONING: VersioningPolicy = {
  mode: 'content-addressable',
};

export interface ImmichPublishDestinationOptions {
  resolveAdapter?: (connectionId: string) => CloudStorageAdapter;
  ensureConnectionsCached?: () => void;
}

export class ImmichPublishDestination implements PublishDestinationAdapter {
  readonly kind = 'immich' as const;

  private readonly resolveAdapter: (
    connectionId: string,
  ) => CloudStorageAdapter;
  private readonly ensureConnectionsCached: () => void;

  constructor(options: ImmichPublishDestinationOptions = {}) {
    this.resolveAdapter =
      options.resolveAdapter ??
      ((connectionId) => cloudStorageRegistry.resolve(connectionId));
    this.ensureConnectionsCached =
      options.ensureConnectionsCached ??
      (() => new LocalPersonalMediaStore().ensureCached());
  }

  capabilities(): DestinationCapabilities {
    return IMMICH_PUBLISH_CAPABILITIES;
  }

  plan(input: PublishLegInput): Promise<PublishLegPlan> {
    return this.destinationFor(input).plan(input);
  }

  upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    return this.destinationFor(input).upload(input, ctx);
  }

  async finalize(handle: UploadHandle): Promise<PublishedRef> {
    const ref = handle.providerState?.ref;
    if (isPublishedRef(ref)) return ref;
    throw new Error('Immich publish did not return an uploaded asset ref');
  }

  queryStatus(): Promise<PublishedStatus> {
    return Promise.resolve({ state: 'available' });
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }

  private destinationFor(input: PublishLegInput): CloudStorageDestination {
    const connectionId = input.destination.connectionId;
    if (!connectionId || connectionId === this.kind) {
      throw new Error('Immich publish requires a concrete connection id');
    }

    this.ensureConnectionsCached();
    const adapter = this.resolveAdapter(connectionId);
    if (adapter.provider !== 'immich') {
      throw new Error(
        `Publish connection ${connectionId} is ${adapter.provider}, not immich`,
      );
    }

    return new CloudStorageDestination({
      kind: this.kind,
      connectionId,
      adapter,
      defaultVersioning: IMMICH_DEFAULT_VERSIONING,
      capabilities: IMMICH_PUBLISH_CAPABILITIES,
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
