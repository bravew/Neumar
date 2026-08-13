export interface UploadStartInput {
  totalBytes: number;
  mime?: string;
  fileName?: string;
  initUrl?: string;
  uploadUrl?: string;
  targetPath?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface UploadSessionState {
  sessionId: string;
  totalBytes: number;
  committedBytes: number;
  etags?: string[];
  expiresAt?: string;
  protocolMetadata?: Record<string, unknown>;
}

export interface UploadFinalizeResult {
  providerId: string;
  etag?: string;
  revision?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface UploadQueryResult {
  committedBytes: number;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UploadSession {
  readonly protocol: string;
  start(input: UploadStartInput): Promise<UploadSessionState>;
  append(
    state: UploadSessionState,
    chunk: Buffer,
    offset: number,
  ): Promise<UploadSessionState>;
  finalize(state: UploadSessionState): Promise<UploadFinalizeResult>;
  query(state: UploadSessionState): Promise<UploadQueryResult>;
  abort(state: UploadSessionState): Promise<void>;
}

export class UploadProtocolRegistry {
  private readonly sessions = new Map<string, UploadSession>();

  register(session: UploadSession): void {
    this.sessions.set(session.protocol, session);
  }

  unregister(protocol: string): void {
    this.sessions.delete(protocol);
  }

  resolve(protocol: string): UploadSession {
    const session = this.sessions.get(protocol);
    if (!session) {
      throw new Error(`No upload protocol registered for ${protocol}`);
    }
    return session;
  }

  list(): UploadSession[] {
    return [...this.sessions.values()];
  }
}

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface HttpUploadDeps {
  fetch?: FetchLike;
}

export function getFetch(deps: HttpUploadDeps = {}): FetchLike {
  return deps.fetch ?? fetch;
}

export function requireStartUrl(input: UploadStartInput): string {
  const url = input.initUrl ?? input.uploadUrl;
  if (!url) throw new Error('Upload start input is missing initUrl/uploadUrl');
  return url;
}

export function requireHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) {
    throw new Error(`Upload response missing ${name} header`);
  }
  return value;
}

export async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

export async function assertStatus(
  response: Response,
  expected: readonly number[],
): Promise<void> {
  if (expected.includes(response.status)) return;
  const body = await response.text().catch(() => '');
  throw new Error(
    `Upload request failed: HTTP ${response.status}${body ? ` ${body}` : ''}`,
  );
}

export function cloneState(
  state: UploadSessionState,
  patch: Partial<UploadSessionState>,
): UploadSessionState {
  return {
    ...state,
    ...patch,
    etags: patch.etags ?? (state.etags ? [...state.etags] : undefined),
    protocolMetadata: {
      ...(state.protocolMetadata ?? {}),
      ...(patch.protocolMetadata ?? {}),
    },
  };
}

export function validateChunkBounds(
  state: UploadSessionState,
  chunk: Buffer,
  offset: number,
): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Invalid upload offset: ${offset}`);
  }
  if (offset + chunk.length > state.totalBytes) {
    throw new Error('Upload chunk exceeds total byte size');
  }
}

export function contentRange(
  offset: number,
  chunkLength: number,
  totalBytes: number,
): string {
  const end = offset + chunkLength - 1;
  return `bytes ${offset}-${end}/${totalBytes}`;
}

export function bufferBody(chunk: Buffer): ArrayBuffer {
  return new Uint8Array(chunk).buffer;
}

export function parseCommittedBytesFromRange(range: string | null): number {
  if (!range) return 0;
  const match = /bytes=(\d+)-(\d+)/.exec(range);
  if (!match) return 0;
  return Number(match[2]) + 1;
}
