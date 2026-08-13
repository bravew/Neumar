import {
  cloneState,
  validateChunkBounds,
  type UploadFinalizeResult,
  type UploadQueryResult,
  type UploadSession,
  type UploadSessionState,
  type UploadStartInput,
} from '../upload-session';

export interface S3UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface S3MultipartTransport {
  createMultipartUpload(input: UploadStartInput): Promise<{ uploadId: string }>;
  uploadPart(input: {
    uploadId: string;
    partNumber: number;
    chunk: Buffer;
    offset: number;
  }): Promise<{ etag: string }>;
  listParts(uploadId: string): Promise<S3UploadedPart[]>;
  completeMultipartUpload(input: {
    uploadId: string;
    parts: S3UploadedPart[];
  }): Promise<UploadFinalizeResult>;
  abortMultipartUpload(uploadId: string): Promise<void>;
}

export class S3MultipartUploadSession implements UploadSession {
  readonly protocol = 's3-multipart';

  constructor(private readonly transport: S3MultipartTransport) {}

  async start(input: UploadStartInput): Promise<UploadSessionState> {
    const { uploadId } = await this.transport.createMultipartUpload(input);
    return {
      sessionId: uploadId,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      etags: [],
      protocolMetadata: { parts: [] },
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const partNumber =
      ((state.protocolMetadata?.parts as S3UploadedPart[] | undefined)
        ?.length ?? 0) + 1;
    const result = await this.transport.uploadPart({
      uploadId: state.sessionId,
      partNumber,
      chunk,
      offset,
    });
    const part = { partNumber, etag: result.etag, size: chunk.length };
    const parts = [
      ...((state.protocolMetadata?.parts as S3UploadedPart[] | undefined) ??
        []),
      part,
    ];
    return cloneState(state, {
      committedBytes: offset + chunk.length,
      etags: parts.map((p) => p.etag),
      protocolMetadata: { parts },
    });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    const parts =
      (state.protocolMetadata?.parts as S3UploadedPart[] | undefined) ?? [];
    return this.transport.completeMultipartUpload({
      uploadId: state.sessionId,
      parts,
    });
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    const parts = await this.transport.listParts(state.sessionId);
    return {
      committedBytes: parts.reduce((sum, part) => sum + part.size, 0),
      metadata: { parts },
    };
  }

  async abort(state: UploadSessionState): Promise<void> {
    await this.transport.abortMultipartUpload(state.sessionId);
  }
}
