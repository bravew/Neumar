import { readFile, stat } from 'fs/promises';
import path from 'path';

import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import type { CloudFile } from '@/shared/integrations/cloud-storage/types';

import type {
  DestinationCapabilities,
  DestinationKind,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  UploadHandle,
  VersioningPolicy,
  LegContext,
} from '../types';
import { resolveTargetPath } from '../versioning/policy';

export interface CloudStorageDestinationOptions {
  kind: DestinationKind;
  connectionId: string;
  adapter: CloudStorageAdapter;
  defaultParentId?: string | null;
  defaultVersioning?: VersioningPolicy;
  capabilities?: Partial<DestinationCapabilities> & {
    versioningEnabled?: boolean;
  };
  findExisting?: (input: {
    targetPath: string;
    sourceSha256: string;
  }) => Promise<CloudFile | null>;
}

const defaultVersioning: VersioningPolicy = { mode: 'content-addressable' };

export class CloudStorageDestination implements PublishDestinationAdapter {
  readonly kind: DestinationKind;

  private readonly connectionId: string;
  private readonly adapter: CloudStorageAdapter;
  private readonly defaultParentId: string | null;
  private readonly defaultVersioning: VersioningPolicy;
  private readonly extraCapabilities: CloudStorageDestinationOptions['capabilities'];
  private readonly findExisting?: CloudStorageDestinationOptions['findExisting'];

  constructor(options: CloudStorageDestinationOptions) {
    this.kind = options.kind;
    this.connectionId = options.connectionId;
    this.adapter = options.adapter;
    this.defaultParentId = options.defaultParentId ?? null;
    this.defaultVersioning = options.defaultVersioning ?? defaultVersioning;
    this.extraCapabilities = options.capabilities;
    this.findExisting = options.findExisting;
  }

  capabilities(): DestinationCapabilities & { versioningEnabled?: boolean } {
    const cloudCapabilities = this.adapter.getCapabilities();
    return {
      supportsResumable: this.extraCapabilities?.supportsResumable ?? true,
      supportsVersioning: Boolean(this.extraCapabilities?.supportsVersioning),
      requiresReformat: false,
      acceptedMimePrefixes: this.extraCapabilities?.acceptedMimePrefixes ?? [
        'image/',
        'video/',
        'audio/',
        'text/',
        'application/',
      ],
      approvalDefault: false,
      maxBytes: this.extraCapabilities?.maxBytes,
      versioningEnabled: this.extraCapabilities?.versioningEnabled,
      resumable: this.extraCapabilities?.resumable,
      quota: this.extraCapabilities?.quota,
      metadata: {
        fullTextSearch: cloudCapabilities.fullTextSearch,
        watch: cloudCapabilities.watch,
      },
    } as DestinationCapabilities & { versioningEnabled?: boolean };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    const policy = input.destination.versioning ?? this.defaultVersioning;
    const targetBaseName = this.targetBaseName(input);
    const resolved = resolveTargetPath(
      targetBaseName,
      input.source.sha256,
      policy,
      this.capabilities(),
    );
    const existing = this.findExisting
      ? await this.findExisting({
          targetPath: resolved.path,
          sourceSha256: input.source.sha256,
        })
      : null;

    return {
      destinationKind: this.kind,
      targetRef: existing?.id,
      targetPath: resolved.path,
      uploadBytes: existing ? 0 : input.source.sizeBytes,
      estimatedBytes: input.source.sizeBytes,
      willReformat: false,
      alreadyCurrent: Boolean(existing),
      requiresApproval: input.destination.approvalRequired,
      quotaPreview: [],
      warnings: [],
      metadata: {
        mode: resolved.mode,
        existingRevision: existing?.revision,
      },
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    const plan = await this.plan(input);
    if (plan.alreadyCurrent) {
      ctx.recordChunkProgress(0);
      return {
        offsetBytes: 0,
        providerState: {
          alreadyCurrent: true,
          targetRef: plan.targetRef,
          targetPath: plan.targetPath,
        },
      };
    }

    await assertWithinSizeLimit(input.source.path, this.capabilities());
    const content = await readFile(input.source.path);
    const uploaded = await this.adapter.upload({
      parentId: this.parentId(input),
      name: path.basename(plan.targetPath ?? this.targetBaseName(input)),
      content: new Blob([new Uint8Array(content).buffer]),
      mimeType: input.source.mime,
      overwrite: input.destination.versioning?.mode === 'overwrite',
      metadata: {
        sha256: input.source.sha256,
        publishJobId: input.jobId,
        publishLegId: input.legId,
      },
    });
    ctx.recordChunkProgress(input.source.sizeBytes);

    return {
      offsetBytes: input.source.sizeBytes,
      providerState: {
        ref: cloudFileToPublishedRef(uploaded, this.connectionId),
        targetPath: plan.targetPath,
      },
    };
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
    return handle.providerState?.ref as PublishedRef;
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }

  async abort(): Promise<void> {
    return;
  }

  private targetBaseName(input: PublishLegInput): string {
    return (
      (input.destination.target?.path as string | undefined) ??
      input.metadata.title ??
      path.basename(input.source.path)
    );
  }

  private parentId(input: PublishLegInput): string | null {
    return (
      (input.destination.target?.parentId as string | undefined) ??
      this.defaultParentId
    );
  }
}

async function assertWithinSizeLimit(
  sourcePath: string,
  capabilities: DestinationCapabilities,
): Promise<void> {
  if (capabilities.maxBytes === undefined) return;
  const { size } = await stat(sourcePath);
  if (size <= capabilities.maxBytes) return;
  throw new Error(
    `publish_source_exceeds_destination_max_bytes:${size}:${capabilities.maxBytes}`,
  );
}

export function cloudFileToPublishedRef(
  file: CloudFile,
  connectionId?: string,
): PublishedRef {
  const mediaType = mediaTypeFromMime(file.mimeType);
  return {
    providerId: file.id,
    url: file.webUrl,
    revision: file.revision,
    metadata: {
      connectionId,
      name: file.name,
      path: file.path,
      etag: file.etag,
      provider: file.provider,
      mimeType: file.mimeType,
      mediaType,
      thumbnailUrl: connectionId
        ? `/cloud-storage/connections/${encodeURIComponent(
            connectionId,
          )}/items/${encodeURIComponent(file.id)}/thumbnail`
        : file.thumbnailUrl,
      contentUrl: connectionId
        ? `/cloud-storage/connections/${encodeURIComponent(
            connectionId,
          )}/items/${encodeURIComponent(file.id)}/content`
        : undefined,
    },
  };
}

function mediaTypeFromMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}
