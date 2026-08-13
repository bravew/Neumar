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

interface TikTokStartResponse {
  data?: {
    publish_id?: string;
    upload_url?: string;
  };
}

export class TikTokChunkedUploadSession implements UploadSession {
  readonly protocol = 'tiktok-chunked';

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
    const body = await readJson<TikTokStartResponse>(response);
    const uploadUrl = body.data?.upload_url;
    const publishId = body.data?.publish_id;
    if (!uploadUrl || !publishId) {
      throw new Error(
        'TikTok upload init response missing upload_url/publish_id',
      );
    }
    return {
      sessionId: uploadUrl,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      protocolMetadata: { publishId },
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
        'Content-Type': 'video/mp4',
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
      providerId: state.protocolMetadata?.publishId as string,
      metadata: { uploadUrl: state.sessionId },
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    if (!this.statusUrl) return { committedBytes: state.committedBytes };
    const publishId = state.protocolMetadata?.publishId as string;
    const response = await this.fetch(
      `${this.statusUrl}?publish_id=${publishId}`,
    );
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
