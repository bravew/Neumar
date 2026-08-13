import {
  assertStatus,
  bufferBody,
  cloneState,
  contentRange,
  getFetch,
  readJson,
  requireStartUrl,
  validateChunkBounds,
  type HttpUploadDeps,
  type UploadFinalizeResult,
  type UploadQueryResult,
  type UploadSession,
  type UploadSessionState,
  type UploadStartInput,
} from '../upload-session';

interface InstagramStartResponse {
  id?: string;
  upload_url?: string;
}

export class InstagramRuploadSession implements UploadSession {
  readonly protocol = 'instagram-rupload';

  private readonly fetch: typeof fetch;
  private readonly statusUrl?: string;

  constructor(deps: HttpUploadDeps & { statusUrl?: string } = {}) {
    this.fetch = getFetch(deps) as typeof fetch;
    this.statusUrl = deps.statusUrl;
  }

  async start(input: UploadStartInput): Promise<UploadSessionState> {
    const response = await this.fetch(requireStartUrl(input), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.headers ?? {}),
      },
      body: input.body ?? JSON.stringify(input.metadata ?? {}),
      signal: input.signal,
    });
    await assertStatus(response, [200]);
    const body = await readJson<InstagramStartResponse>(response);
    if (!body.id || !body.upload_url) {
      throw new Error(
        'Instagram init response missing container id/upload_url',
      );
    }
    return {
      sessionId: body.upload_url,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      protocolMetadata: { containerId: body.id },
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const response = await this.fetch(state.sessionId, {
      method: 'POST',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': contentRange(offset, chunk.length, state.totalBytes),
      },
      body: bufferBody(chunk),
    });
    await assertStatus(response, [200, 201, 204]);
    return cloneState(state, { committedBytes: offset + chunk.length });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    return {
      providerId: state.protocolMetadata?.containerId as string,
      metadata: { uploadUrl: state.sessionId },
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    if (!this.statusUrl) return { committedBytes: state.committedBytes };
    const containerId = state.protocolMetadata?.containerId as string;
    const response = await this.fetch(`${this.statusUrl}/${containerId}`);
    await assertStatus(response, [200]);
    return {
      committedBytes: state.committedBytes,
      metadata: await readJson<Record<string, unknown>>(response),
    };
  }

  async abort(): Promise<void> {
    return;
  }
}
