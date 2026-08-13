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

interface DropboxStartResponse {
  session_id: string;
}

interface DropboxFinishResponse {
  id: string;
  rev?: string;
  path_display?: string;
}

export class DropboxUploadSession implements UploadSession {
  readonly protocol = 'dropbox-session';

  private readonly fetch: typeof fetch;
  private readonly appendUrl: string;
  private readonly finishUrl: string;

  constructor(
    deps: HttpUploadDeps & { appendUrl?: string; finishUrl?: string } = {},
  ) {
    this.fetch = getFetch(deps) as typeof fetch;
    this.appendUrl =
      deps.appendUrl ??
      'https://content.dropboxapi.com/2/files/upload_session/append_v2';
    this.finishUrl =
      deps.finishUrl ??
      'https://content.dropboxapi.com/2/files/upload_session/finish';
  }

  async start(input: UploadStartInput): Promise<UploadSessionState> {
    const response = await this.fetch(requireStartUrl(input), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ close: false }),
        ...(input.headers ?? {}),
      },
      body: input.body ?? null,
      signal: input.signal,
    });
    await assertStatus(response, [200]);
    const body = await readJson<DropboxStartResponse>(response);
    return {
      sessionId: body.session_id,
      totalBytes: input.totalBytes,
      committedBytes: 0,
      protocolMetadata: { targetPath: input.targetPath },
    };
  }

  async append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState> {
    validateChunkBounds(state, chunk, offset);
    const response = await this.fetch(this.appendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          cursor: { session_id: state.sessionId, offset },
          close: false,
        }),
      },
      body: bufferBody(chunk),
    });
    if (response.status === 409) {
      const body = await readJson<{ error?: { correct_offset?: number } }>(
        response,
      );
      const correctOffset = body.error?.correct_offset;
      if (typeof correctOffset === 'number') {
        return cloneState(state, { committedBytes: correctOffset });
      }
    }
    await assertStatus(response, [200]);
    return cloneState(state, { committedBytes: offset + chunk.length });
  }

  async finalize(state: UploadSessionState): Promise<UploadFinalizeResult> {
    const response = await this.fetch(this.finishUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          cursor: { session_id: state.sessionId, offset: state.committedBytes },
          commit: {
            path:
              (state.protocolMetadata?.targetPath as string | undefined) ??
              `/${state.sessionId}`,
            mode: 'add',
            autorename: true,
          },
        }),
      },
      body: null,
    });
    await assertStatus(response, [200]);
    const body = await readJson<DropboxFinishResponse>(response);
    return {
      providerId: body.id,
      revision: body.rev,
      url: body.path_display,
    };
  }

  async query(state: UploadSessionState): Promise<UploadQueryResult> {
    return { committedBytes: state.committedBytes };
  }

  async abort(): Promise<void> {
    return;
  }
}
