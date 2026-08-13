import {
  assertStatus,
  bufferBody,
  cloneState,
  contentRange,
  getFetch,
  parseCommittedBytesFromRange,
  readJson,
  requireHeader,
  requireStartUrl,
  validateChunkBounds,
  type HttpUploadDeps,
  type UploadFinalizeResult,
  type UploadQueryResult,
  type UploadSession,
  type UploadSessionState,
  type UploadStartInput,
} from '../upload-session';

export class GoogleResumableUploadSession implements UploadSession {
  readonly protocol = 'google-resumable';

  private readonly fetch: typeof fetch;

  constructor(deps: HttpUploadDeps = {}) {
    this.fetch = getFetch(deps) as typeof fetch;
  }

  async start(input: UploadStartInput): Promise<UploadSessionState> {
    const response = await this.fetch(requireStartUrl(input), {
      method: 'POST',
      headers: {
        'X-Upload-Content-Length': String(input.totalBytes),
        ...(input.mime ? { 'X-Upload-Content-Type': input.mime } : {}),
        ...(input.headers ?? {}),
      },
      body: input.body,
      signal: input.signal,
    });
    await assertStatus(response, [200, 201]);
    return {
      sessionId: requireHeader(response, 'Location'),
      totalBytes: input.totalBytes,
      committedBytes: 0,
      expiresAt: input.metadata?.expiresAt as string | undefined,
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const response = await this.fetch(state.sessionId, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': contentRange(offset, chunk.length, state.totalBytes),
      },
      body: bufferBody(chunk),
    });

    if (response.status === 308) {
      return cloneState(state, {
        committedBytes: Math.max(
          offset + chunk.length,
          parseCommittedBytesFromRange(response.headers.get('Range')),
        ),
      });
    }

    await assertStatus(response, [200, 201]);
    return cloneState(state, { committedBytes: state.totalBytes });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    return {
      providerId:
        (state.protocolMetadata?.providerId as string) ?? state.sessionId,
      url: state.sessionId,
      metadata: state.protocolMetadata,
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    const response = await this.fetch(state.sessionId, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${state.totalBytes}`,
      },
    });
    if (response.status === 308) {
      return {
        committedBytes: parseCommittedBytesFromRange(
          response.headers.get('Range'),
        ),
      };
    }
    if (response.ok) {
      const body = await readJson<Record<string, unknown>>(response).catch(
        () => ({}),
      );
      return {
        committedBytes: state.totalBytes,
        metadata: body,
      };
    }
    await assertStatus(response, [308, 200, 201]);
    return { committedBytes: state.committedBytes };
  }

  async abort(state: UploadSessionState): Promise<void> {
    const response = await this.fetch(state.sessionId, { method: 'DELETE' });
    await assertStatus(response, [200, 204, 404, 410]);
  }
}
