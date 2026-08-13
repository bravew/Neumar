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

interface LinkedInUploadInstruction {
  uploadUrl: string;
  firstByte: number;
  lastByte: number;
}

interface LinkedInStartResponse {
  value?: {
    video?: string;
    uploadInstructions?: LinkedInUploadInstruction[];
  };
}

export class LinkedInChunkedUploadSession implements UploadSession {
  readonly protocol = 'linkedin-chunked';

  private readonly fetch: typeof fetch;
  private readonly finalizeUrl?: string;
  private readonly statusUrl?: string;

  constructor(
    deps: HttpUploadDeps & { finalizeUrl?: string; statusUrl?: string } = {},
  ) {
    this.fetch = getFetch(deps) as typeof fetch;
    this.finalizeUrl = deps.finalizeUrl;
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
    await assertStatus(response, [200, 201]);
    const body = await readJson<LinkedInStartResponse>(response);
    const video = body.value?.video;
    const uploadInstructions = body.value?.uploadInstructions ?? [];
    if (!video || !uploadInstructions.length) {
      throw new Error(
        'LinkedIn init response missing video/upload instructions',
      );
    }
    return {
      sessionId: video,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      etags: [],
      protocolMetadata: { uploadInstructions },
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const instruction = findInstruction(state, offset);
    const response = await this.fetch(instruction.uploadUrl, {
      method: 'PUT',
      body: bufferBody(chunk),
    });
    await assertStatus(response, [200, 201, 204]);
    const etag = response.headers.get('ETag') ?? response.headers.get('etag');
    const etags = [...(state.etags ?? [])];
    if (etag) etags.push(etag);
    return cloneState(state, {
      committedBytes: offset + chunk.length,
      etags,
    });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    if (!this.finalizeUrl) return { providerId: state.sessionId };
    const response = await this.fetch(this.finalizeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video: state.sessionId,
        uploadedPartIds: state.etags ?? [],
      }),
    });
    await assertStatus(response, [200, 201, 204]);
    return {
      providerId: state.sessionId,
      metadata: await readJson<Record<string, unknown>>(response).catch(
        () => ({}),
      ),
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    if (!this.statusUrl) return { committedBytes: state.committedBytes };
    const response = await this.fetch(`${this.statusUrl}/${state.sessionId}`);
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

function findInstruction(
  state: UploadSessionState,
  offset: number,
): LinkedInUploadInstruction {
  const instructions = (state.protocolMetadata?.uploadInstructions ??
    []) as LinkedInUploadInstruction[];
  const match = instructions.find(
    (instruction) =>
      offset >= instruction.firstByte && offset <= instruction.lastByte,
  );
  if (!match) throw new Error(`No LinkedIn upload URL for offset ${offset}`);
  return match;
}
