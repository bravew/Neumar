import crypto from 'crypto';

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

interface BoxStartResponse {
  id: string;
  session_endpoints?: {
    upload_part?: string;
    commit?: string;
    abort?: string;
    status?: string;
  };
  part_size?: number;
}

interface BoxPart {
  part_id: string;
  offset: number;
  size: number;
  sha1: string;
}

interface BoxEndpoints {
  upload_part: string;
  commit: string;
  abort: string;
  status: string;
}

export class BoxUploadsSession implements UploadSession {
  readonly protocol = 'box-uploads-session';

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
    const body = await readJson<BoxStartResponse>(response);
    return {
      sessionId: body.id,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      protocolMetadata: {
        endpoints: body.session_endpoints ?? {},
        partSize: body.part_size,
        parts: [],
      },
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const endpoints = endpointsFor(state);
    const sha1 = crypto.createHash('sha1').update(chunk).digest('base64');
    const response = await this.fetch(endpoints.upload_part, {
      method: 'PUT',
      headers: {
        Digest: `sha=${sha1}`,
        'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${state.totalBytes}`,
      },
      body: bufferBody(chunk),
    });
    await assertStatus(response, [200, 201]);
    const body = await readJson<{ part: BoxPart }>(response);
    const parts = [...((state.protocolMetadata?.parts as BoxPart[]) ?? [])];
    parts.push(body.part);
    return cloneState(state, {
      committedBytes: offset + chunk.length,
      protocolMetadata: { parts },
    });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    const endpoints = endpointsFor(state);
    const parts =
      (state.protocolMetadata?.parts as BoxPart[] | undefined) ?? [];
    const fileSha1 =
      (state.protocolMetadata?.fileSha1 as string | undefined) ?? '';
    const response = await this.fetch(endpoints.commit, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fileSha1 ? { Digest: `sha=${fileSha1}` } : {}),
      },
      body: JSON.stringify({ parts }),
    });
    await assertStatus(response, [200, 201, 202]);
    const body = await readJson<Record<string, unknown>>(response).catch(
      () => ({}) as Record<string, unknown>,
    );
    return {
      providerId: (body.id as string | undefined) ?? state.sessionId,
      metadata: body,
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    const endpoints = endpointsFor(state);
    const response = await this.fetch(endpoints.status);
    await assertStatus(response, [200]);
    return {
      committedBytes: state.committedBytes,
      metadata: await readJson<Record<string, unknown>>(response),
    };
  }

  async abort(state: UploadSessionState): Promise<void> {
    const endpoints = endpointsFor(state);
    const response = await this.fetch(endpoints.abort, { method: 'DELETE' });
    await assertStatus(response, [200, 202, 204, 404]);
  }
}

function endpointsFor(state: UploadSessionState): BoxEndpoints {
  const endpoints = (state.protocolMetadata?.endpoints ??
    {}) as Partial<BoxEndpoints>;
  for (const key of ['upload_part', 'commit', 'abort', 'status'] as const) {
    if (!endpoints[key]) throw new Error(`Box session missing ${key} endpoint`);
  }
  return endpoints as BoxEndpoints;
}
