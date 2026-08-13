import {
  assertStatus,
  bufferBody,
  cloneState,
  getFetch,
  requireHeader,
  requireStartUrl,
  validateChunkBounds,
  type HttpUploadDeps,
  type UploadFinalizeResult,
  type UploadQueryResult,
  type UploadSession,
  type UploadSessionState,
  type UploadStartInput,
} from './upload-session';

export class TusFallbackUploadSession implements UploadSession {
  readonly protocol = 'tus-1.0';

  private readonly fetch: typeof fetch;

  constructor(deps: HttpUploadDeps = {}) {
    this.fetch = getFetch(deps) as typeof fetch;
  }

  async start(input: UploadStartInput): Promise<UploadSessionState> {
    const response = await this.fetch(requireStartUrl(input), {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(input.totalBytes),
        ...(input.headers ?? {}),
      },
      signal: input.signal,
    });
    await assertStatus(response, [201]);
    return {
      sessionId: new URL(
        requireHeader(response, 'Location'),
        requireStartUrl(input),
      ).toString(),
      totalBytes: input.totalBytes,
      committedBytes: 0,
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const response = await this.fetch(state.sessionId, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      body: bufferBody(chunk),
    });
    await assertStatus(response, [204]);
    return cloneState(state, {
      committedBytes: Number(requireHeader(response, 'Upload-Offset')),
    });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    return { providerId: state.sessionId, url: state.sessionId };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    const response = await this.fetch(state.sessionId, {
      method: 'HEAD',
      headers: { 'Tus-Resumable': '1.0.0' },
    });
    await assertStatus(response, [200, 204]);
    return {
      committedBytes: Number(requireHeader(response, 'Upload-Offset')),
    };
  }

  async abort(state: UploadSessionState): Promise<void> {
    const response = await this.fetch(state.sessionId, {
      method: 'DELETE',
      headers: { 'Tus-Resumable': '1.0.0' },
    });
    await assertStatus(response, [200, 202, 204, 404]);
  }
}
