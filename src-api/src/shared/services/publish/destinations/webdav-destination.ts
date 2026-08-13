import { readFile } from 'fs/promises';
import path from 'path';

import type { WebDavClient } from '@/shared/integrations/storage/webdav';

import type {
  DestinationCapabilities,
  LegContext,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  UploadHandle,
  VersioningPolicy,
} from '../types';
import { resolveTargetPath } from '../versioning';

export interface WebDavDestinationOptions {
  client: WebDavClient;
  defaultVersioning?: VersioningPolicy;
  maxNonResumableBytes?: number;
}

const defaultPolicy: VersioningPolicy = { mode: 'content-addressable' };

export class WebDavDestination implements PublishDestinationAdapter {
  readonly kind = 'webdav' as const;

  constructor(private readonly options: WebDavDestinationOptions) {}

  capabilities(): DestinationCapabilities {
    return {
      supportsResumable: false,
      supportsVersioning: false,
      requiresReformat: false,
      acceptedMimePrefixes: [
        'image/',
        'video/',
        'audio/',
        'text/',
        'application/',
      ],
      approvalDefault: false,
      maxBytes: this.options.maxNonResumableBytes,
    };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    const policy =
      input.destination.versioning ??
      this.options.defaultVersioning ??
      defaultPolicy;
    const baseName = targetName(input);
    const targetPath =
      policy.mode === 'timestamped-folder'
        ? baseName
        : resolveTargetPath(
            baseName,
            input.source.sha256,
            policy,
            this.capabilities(),
          ).path;
    return {
      destinationKind: this.kind,
      targetPath,
      uploadBytes: input.source.sizeBytes,
      estimatedBytes: input.source.sizeBytes,
      willReformat: false,
      requiresApproval: input.destination.approvalRequired,
      warnings: [
        'Generic WebDAV uploads restart from byte 0 after interruption.',
      ],
      quotaPreview: [],
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    const policy =
      input.destination.versioning ??
      this.options.defaultVersioning ??
      defaultPolicy;
    const plan = await this.plan(input);
    const snapshotPath =
      policy.mode === 'timestamped-folder'
        ? resolveTargetPath(
            targetName(input),
            input.source.sha256,
            policy,
            this.capabilities(),
          ).path
        : undefined;
    const content = await readFile(input.source.path);
    const result = await this.options.client.uploadAtomic({
      targetPath: plan.targetPath ?? targetName(input),
      snapshotPath,
      content: new Blob([new Uint8Array(content).buffer]),
      contentType: input.source.mime,
    });
    ctx.recordChunkProgress(input.source.sizeBytes);
    return {
      sessionId: result.providerId,
      offsetBytes: input.source.sizeBytes,
      providerState: { ref: webDavRef(result) },
    };
  }

  async finalize(handle: UploadHandle): Promise<PublishedRef> {
    return handle.providerState?.ref as PublishedRef;
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }

  async abort(): Promise<void> {
    return;
  }
}

function targetName(input: PublishLegInput): string {
  return (
    (input.destination.target?.path as string | undefined) ??
    input.metadata.title ??
    path.basename(input.source.path)
  );
}

function webDavRef(result: {
  providerId: string;
  url: string;
  snapshotPath?: string;
  restartedFromZero: boolean;
}): PublishedRef {
  return {
    providerId: result.providerId,
    url: result.url,
    metadata: {
      snapshotPath: result.snapshotPath,
      restartedFromZero: result.restartedFromZero,
    },
  };
}
