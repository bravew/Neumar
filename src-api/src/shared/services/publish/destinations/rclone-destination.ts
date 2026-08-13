import path from 'path';

import type { RcloneBridge } from '@/shared/integrations/storage/rclone-bridge';

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

export class RcloneDestination implements PublishDestinationAdapter {
  readonly kind = 'rclone' as const;

  constructor(private readonly bridge: RcloneBridge) {}

  capabilities(): DestinationCapabilities {
    return {
      supportsResumable: true,
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
      resumable: { protocol: 'rclone' },
    };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    const remote = input.destination.target?.remote as string | undefined;
    if (!remote) throw new Error('rclone destination requires target.remote');
    return {
      destinationKind: this.kind,
      targetPath: targetPath(input),
      uploadBytes: input.source.sizeBytes,
      estimatedBytes: input.source.sizeBytes,
      willReformat: false,
      requiresApproval: input.destination.approvalRequired,
      quotaPreview: [],
      warnings: ['rclone destinations require an existing configured remote.'],
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    const remote = input.destination.target?.remote as string | undefined;
    if (!remote) throw new Error('rclone destination requires target.remote');
    const destinationPath = targetPath(input);
    const result = await this.bridge.copyFile({
      sourcePath: input.source.path,
      remote,
      destinationPath,
    });
    ctx.recordChunkProgress(input.source.sizeBytes);
    return {
      sessionId: result.providerId,
      offsetBytes: input.source.sizeBytes,
      providerState: { ref: result },
    };
  }

  async finalize(handle: UploadHandle): Promise<PublishedRef> {
    const ref = handle.providerState?.ref as { providerId: string };
    return {
      providerId: ref.providerId,
      metadata: { transport: 'rclone' },
    };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }

  async abort(): Promise<void> {
    return;
  }
}

function targetPath(input: PublishLegInput): string {
  return (
    (input.destination.target?.path as string | undefined) ??
    input.metadata.title ??
    path.basename(input.source.path)
  );
}
