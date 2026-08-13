import crypto from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import type {
  PublishLegInput,
  SourceArtifact,
} from '@/shared/services/publish/types';
import type {
  UploadFinalizeResult,
  UploadQueryResult,
  UploadSession,
  UploadSessionState,
  UploadStartInput,
} from '@/shared/services/publish/upload';

export class MemoryUploadSession implements UploadSession {
  readonly starts: UploadStartInput[] = [];
  readonly chunks: Array<{ offset: number; length: number }> = [];

  constructor(
    readonly protocol: string,
    private readonly providerId = `${protocol}:media`,
  ) {}

  async start(input: UploadStartInput): Promise<UploadSessionState> {
    this.starts.push(input);
    return {
      sessionId: `${this.protocol}:session`,
      totalBytes: input.totalBytes,
      committedBytes: 0,
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    this.chunks.push({ offset, length: chunk.length });
    return { ...state, committedBytes: offset + chunk.length };
  }

  async finalize(): Promise<UploadFinalizeResult> {
    return {
      providerId: this.providerId,
      url: `https://social.example/${this.providerId}`,
      metadata: { finalized: true },
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    return { committedBytes: state.committedBytes };
  }

  async abort(): Promise<void> {
    return;
  }
}

export function createSourceFixture(): {
  dir: string;
  source: SourceArtifact;
  close(): void;
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'publish-social-'));
  const sourcePath = path.join(dir, 'video.mp4');
  const bytes = Buffer.from('fake social video');
  writeFileSync(sourcePath, bytes);
  return {
    dir,
    source: {
      artifactId: 'artifact-1',
      path: sourcePath,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      mime: 'video/mp4',
      provenance: {
        provider: 'neuma',
        model: 'video-gen-1',
        aiGenerated: true,
      },
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function createSocialInput(
  source: SourceArtifact,
  kind: PublishLegInput['destination']['kind'],
  target: Record<string, unknown> = {},
): PublishLegInput {
  return {
    jobId: 'job-1',
    legId: 'leg-1',
    source,
    metadata: {
      title: 'Launch video',
      description: 'Generated with Neuma',
      tags: ['launch'],
      generatedByNeumaAgent: true,
    },
    destination: {
      kind,
      connectionId: 'conn-1',
      approvalRequired: true,
      target,
    },
  };
}
