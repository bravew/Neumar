import {
  assertStatus,
  bufferBody,
  cloneState,
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

interface XInitResponse {
  media_id_string?: string;
  media_id?: number;
}

interface XFinalizeResponse extends XInitResponse {
  processing_info?: Record<string, unknown>;
}

export class XMediaUploadSession implements UploadSession {
  readonly protocol = 'x-media-upload';

  private readonly fetch: typeof fetch;

  constructor(deps: HttpUploadDeps = {}) {
    this.fetch = getFetch(deps) as typeof fetch;
  }

  async start(input: UploadStartInput): Promise<UploadSessionState> {
    const body = new URLSearchParams({
      command: 'INIT',
      total_bytes: String(input.totalBytes),
      media_type: input.mime ?? 'application/octet-stream',
    });
    const response = await this.fetch(requireStartUrl(input), {
      method: 'POST',
      headers: input.headers,
      body,
      signal: input.signal,
    });
    await assertStatus(response, [200, 201]);
    const parsed = await readJson<XInitResponse>(response);
    const mediaId = parsed.media_id_string ?? String(parsed.media_id);
    if (!mediaId) throw new Error('X INIT response missing media_id');
    return {
      sessionId: mediaId,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      protocolMetadata: {
        endpoint: requireStartUrl(input),
        segmentIndex: 0,
      },
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const endpoint = state.protocolMetadata?.endpoint as string;
    const segmentIndex = Number(state.protocolMetadata?.segmentIndex ?? 0);
    const body = new FormData();
    body.set('command', 'APPEND');
    body.set('media_id', state.sessionId);
    body.set('segment_index', String(segmentIndex));
    body.set('media', new Blob([bufferBody(chunk)]));
    const response = await this.fetch(endpoint, { method: 'POST', body });
    await assertStatus(response, [200, 201, 204]);
    return cloneState(state, {
      committedBytes: offset + chunk.length,
      protocolMetadata: {
        segmentIndex: segmentIndex + 1,
      },
    });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    const endpoint = state.protocolMetadata?.endpoint as string;
    const response = await this.fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        command: 'FINALIZE',
        media_id: state.sessionId,
      }),
    });
    await assertStatus(response, [200, 201]);
    const body = await readJson<XFinalizeResponse>(response);
    return {
      providerId: body.media_id_string ?? state.sessionId,
      metadata: body.processing_info,
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    const endpoint = state.protocolMetadata?.endpoint as string;
    const url = new URL(endpoint);
    url.searchParams.set('command', 'STATUS');
    url.searchParams.set('media_id', state.sessionId);
    const response = await this.fetch(url);
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
