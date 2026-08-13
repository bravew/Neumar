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

interface MicrosoftStartResponse {
  uploadUrl: string;
  expirationDateTime?: string;
}

interface MicrosoftAppendResponse {
  id?: string;
  eTag?: string;
  webUrl?: string;
  expirationDateTime?: string;
  nextExpectedRanges?: string[];
}

export class MicrosoftUploadSession implements UploadSession {
  readonly protocol = 'microsoft-upload-session';

  private readonly fetch: typeof fetch;

  constructor(deps: HttpUploadDeps = {}) {
    this.fetch = getFetch(deps) as typeof fetch;
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
    await assertStatus(response, [200, 201]);
    const body = await readJson<MicrosoftStartResponse>(response);
    return {
      sessionId: body.uploadUrl,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      expiresAt: body.expirationDateTime,
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
    const body = await readJson<MicrosoftAppendResponse>(response).catch(
      () => ({}) as MicrosoftAppendResponse,
    );
    if (response.status === 202) {
      return cloneState(state, {
        committedBytes: committedFromNextExpectedRange(
          body.nextExpectedRanges,
          offset + chunk.length,
        ),
        expiresAt: body.expirationDateTime ?? state.expiresAt,
      });
    }
    await assertStatus(response, [200, 201]);
    return cloneState(state, {
      committedBytes: state.totalBytes,
      protocolMetadata: {
        providerId: body.id,
        etag: body.eTag,
        url: body.webUrl,
      },
    });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    return {
      providerId:
        (state.protocolMetadata?.providerId as string) ?? state.sessionId,
      etag: state.protocolMetadata?.etag as string | undefined,
      url: state.protocolMetadata?.url as string | undefined,
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    const response = await this.fetch(state.sessionId, { method: 'GET' });
    await assertStatus(response, [200]);
    const body = await readJson<MicrosoftAppendResponse>(response);
    return {
      committedBytes: committedFromNextExpectedRange(
        body.nextExpectedRanges,
        state.committedBytes,
      ),
      expiresAt: body.expirationDateTime,
    };
  }

  async abort(state: UploadSessionState): Promise<void> {
    const response = await this.fetch(state.sessionId, { method: 'DELETE' });
    await assertStatus(response, [200, 202, 204, 404]);
  }
}

function committedFromNextExpectedRange(
  ranges: string[] | undefined,
  fallback: number,
): number {
  const [first] = ranges ?? [];
  if (!first) return fallback;
  const [start] = first.split('-');
  const committed = Number(start);
  return Number.isFinite(committed) ? committed : fallback;
}
