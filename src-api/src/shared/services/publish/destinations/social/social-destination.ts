import path from 'path';

import type { SocialClient } from '@/shared/integrations/social';

import { injectDisclosure } from '../../provenance';
import { quotaPreviewFor, type QuotaSpec } from '../../quota-specs';
import { sourceMatchesReformatSpec } from '../../reformatter';
import type {
  DestinationCapabilities,
  DestinationKind,
  LegContext,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  ReformatSpec,
  UploadHandle,
} from '../../types';
import type { UploadFinalizeResult, UploadSession } from '../../upload';
import { readAlignedChunks } from '../../upload/chunker';

export interface SocialDestinationOptions {
  kind: DestinationKind;
  client: SocialClient;
  uploadSession: UploadSession;
  acceptedMimePrefixes: string[];
  maxBytes?: number;
  reformatSpec?: ReformatSpec;
  quotaSpecs?: QuotaSpec[];
  chunkSizeBytes?: number;
}

export class SocialDestination implements PublishDestinationAdapter {
  readonly kind: DestinationKind;

  private readonly client: SocialClient;
  private readonly uploadSession: UploadSession;
  private readonly acceptedMimePrefixes: string[];
  private readonly maxBytes?: number;
  private readonly reformatSpec?: ReformatSpec;
  private readonly quotaSpecs?: QuotaSpec[];
  private readonly chunkSizeBytes: number;

  constructor(options: SocialDestinationOptions) {
    this.kind = options.kind;
    this.client = options.client;
    this.uploadSession = options.uploadSession;
    this.acceptedMimePrefixes = options.acceptedMimePrefixes;
    this.maxBytes = options.maxBytes;
    this.reformatSpec = options.reformatSpec;
    this.quotaSpecs = options.quotaSpecs;
    this.chunkSizeBytes = options.chunkSizeBytes ?? 8 * 1024 * 1024;
  }

  capabilities(): DestinationCapabilities {
    return {
      supportsResumable: true,
      supportsVersioning: false,
      requiresReformat: Boolean(this.reformatSpec),
      maxBytes: this.maxBytes,
      acceptedMimePrefixes: this.acceptedMimePrefixes,
      approvalDefault: true,
      resumable: {
        protocol: this.uploadSession.protocol,
        minChunkBytes: this.chunkSizeBytes,
      },
      quota: (this.quotaSpecs ?? []).map((spec) => ({
        kind: spec.kind,
        cost: spec.cost,
      })),
    };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    const warnings: string[] = [];
    if (!this.acceptsMime(input.source.mime)) {
      warnings.push(`Source MIME ${input.source.mime} may need reformatting.`);
    }
    if (this.maxBytes && input.source.sizeBytes > this.maxBytes) {
      warnings.push(`Source exceeds destination byte cap ${this.maxBytes}.`);
    }
    const willReformat = !sourceMatchesReformatSpec(
      input.source,
      input.destination.reformatSpec ?? this.reformatSpec,
    );

    return {
      destinationKind: this.kind,
      targetRef: input.destination.connectionId,
      targetPath:
        (input.destination.target?.path as string | undefined) ??
        input.metadata.title ??
        path.basename(input.source.path),
      uploadBytes: input.source.sizeBytes,
      estimatedBytes: input.source.sizeBytes,
      willReformat,
      requiresApproval: true,
      quotaPreview: quotaPreviewFor(this.kind),
      warnings,
      metadata: {
        uploadProtocol: this.uploadSession.protocol,
        approvalDefault: true,
      },
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    const disclosure = injectDisclosure({
      manifest: { aiGenerated: aiGeneratedFrom(input) },
      destinationKind: this.kind,
      captionDisclosureOptIn:
        input.destination.target?.captionDisclosureOptIn === true,
      language: input.destination.target?.language as string | undefined,
    });
    const prepared = await this.client.prepareUpload({
      source: input.source,
      metadata: input.metadata,
      destination: input.destination,
      disclosure,
    });
    let state = await this.uploadSession.start({
      ...prepared.upload,
      totalBytes: input.source.sizeBytes,
      mime: input.source.mime,
      fileName: path.basename(input.source.path),
      signal: ctx.signal,
    });

    for await (const chunk of readAlignedChunks(input.source.path, {
      chunkSize: this.chunkSizeBytes,
    })) {
      state = await this.uploadSession.append(state, chunk.chunk, chunk.offset);
      ctx.recordChunkProgress(state.committedBytes, state.etags);
    }
    const upload = await this.uploadSession.finalize(state);

    return {
      sessionId: state.sessionId,
      offsetBytes: state.committedBytes,
      providerState: {
        upload,
        post: prepared.post,
        disclosure,
      },
    };
  }

  async finalize(handle: UploadHandle): Promise<PublishedRef> {
    const state = handle.providerState as SocialHandleState | undefined;
    if (!state?.upload) {
      throw new Error(`Missing social upload state for ${this.kind}`);
    }
    return this.client.publish({
      upload: state.upload,
      post: state.post ?? {},
      disclosure: state.disclosure ?? {},
      destination: {
        kind: this.kind,
        connectionId: '',
        approvalRequired: true,
      },
      metadata: {},
    });
  }

  async queryStatus(ref: PublishedRef): Promise<PublishedStatus> {
    return this.client.queryStatus(ref);
  }

  async abort(handle: UploadHandle): Promise<void> {
    if (handle.sessionId) {
      await this.uploadSession.abort({
        sessionId: handle.sessionId,
        totalBytes: handle.offsetBytes ?? 0,
        committedBytes: handle.offsetBytes ?? 0,
      });
    }
  }

  private acceptsMime(mime: string): boolean {
    return this.acceptedMimePrefixes.some((prefix) => mime.startsWith(prefix));
  }
}

interface SocialHandleState {
  upload?: UploadFinalizeResult;
  post?: Record<string, unknown>;
  disclosure?: Record<string, unknown>;
}

function aiGeneratedFrom(input: PublishLegInput): boolean {
  return Boolean(
    input.source.provenance?.aiGenerated ||
    input.metadata.aiGenerated ||
    input.metadata.generatedByNeumaAgent,
  );
}
