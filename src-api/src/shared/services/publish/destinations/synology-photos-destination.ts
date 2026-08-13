import { readFile } from 'fs/promises';
import path from 'path';

import type { SynologyPhotosClient } from '@/shared/integrations/storage/synology-photos';

import type {
  DestinationCapabilities,
  LegContext,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  UploadHandle,
} from '../types';

export class SynologyPhotosDestination implements PublishDestinationAdapter {
  readonly kind = 'synology-photos' as const;

  constructor(private readonly client: SynologyPhotosClient) {}

  capabilities(): DestinationCapabilities {
    return {
      supportsResumable: false,
      supportsVersioning: false,
      requiresReformat: false,
      acceptedMimePrefixes: ['image/', 'video/'],
      approvalDefault: false,
    };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    return {
      destinationKind: this.kind,
      targetPath: input.metadata.title ?? path.basename(input.source.path),
      uploadBytes: input.source.sizeBytes,
      estimatedBytes: input.source.sizeBytes,
      willReformat: false,
      requiresApproval: input.destination.approvalRequired,
      warnings: [
        'Synology Photos publishing uses a best-effort local API and may fall back to WebDAV.',
      ],
      quotaPreview: [],
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    const content = await readFile(input.source.path);
    const result = await this.client.upload({
      fileName: path.basename(input.source.path),
      content: new Blob([new Uint8Array(content).buffer], {
        type: input.source.mime,
      }),
      albumId: input.destination.target?.albumId as string | undefined,
    });
    ctx.recordChunkProgress(input.source.sizeBytes);
    return {
      sessionId: result.providerId,
      offsetBytes: input.source.sizeBytes,
      providerState: { ref: result },
    };
  }

  async finalize(handle: UploadHandle): Promise<PublishedRef> {
    const ref = handle.providerState?.ref as {
      providerId: string;
      url?: string;
      sid: string;
    };
    return {
      providerId: ref.providerId,
      url: ref.url,
      metadata: { sid: ref.sid },
    };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }

  async abort(): Promise<void> {
    return;
  }
}
