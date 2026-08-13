import type {
  DestinationCapabilities,
  DestinationKind,
  LegContext,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  UploadHandle,
} from '@/shared/services/publish/types';

export function createFakeAdapter(
  kind: DestinationKind,
): PublishDestinationAdapter {
  return new RestartFakeAdapter(kind);
}

export function createNoopProvenance(sourcePath: string) {
  return {
    signOnce: async () => ({
      signedArtifactPath: sourcePath,
      manifestPath: `${sourcePath}.c2pa.json`,
      manifestSha256: 'm'.repeat(64),
      contentSha256: 'b'.repeat(64),
      embedded: true,
      signerMode: 'local-test' as const,
      runner: {
        sdkPackage: '@contentauth/c2pa-node',
        sdkVersion: '0.5.5',
        specVersion: '2.4',
      },
    }),
  };
}

class RestartFakeAdapter implements PublishDestinationAdapter {
  readonly kind: DestinationKind;

  constructor(kind: DestinationKind) {
    this.kind = kind;
  }

  capabilities(): DestinationCapabilities {
    return {
      supportsResumable: false,
      supportsVersioning: false,
      requiresReformat: false,
      acceptedMimePrefixes: ['video/'],
      approvalDefault: false,
    };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    return {
      destinationKind: this.kind,
      uploadBytes: input.source.sizeBytes,
      requiresApproval: false,
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    ctx.recordChunkProgress(input.source.sizeBytes);
    return {
      sessionId: `${this.kind}:session`,
      offsetBytes: input.source.sizeBytes,
    };
  }

  async finalize(): Promise<PublishedRef> {
    return { providerId: `${this.kind}:published` };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }

  async abort(): Promise<void> {
    return;
  }
}
