import crypto from 'crypto';

import type { FetchLike } from '@/shared/services/publish/upload/upload-session';

export type WebDavAuth =
  | { mode: 'basic'; username: string; password: string }
  | { mode: 'bearer'; token: string }
  | { mode: 'custom-header'; headers: Record<string, string> }
  | { mode: 'none' };

export interface WebDavClientOptions {
  baseUrl: string;
  auth?: WebDavAuth;
  headers?: Record<string, string>;
  fetch?: FetchLike;
}

export interface WebDavUploadInput {
  targetPath: string;
  content: BodyInit;
  contentType?: string;
  snapshotPath?: string;
}

export interface WebDavUploadResult {
  providerId: string;
  url: string;
  snapshotPath?: string;
  restartedFromZero: boolean;
}

export class WebDavClient {
  private readonly baseUrl: string;
  private readonly auth: WebDavAuth;
  private readonly headers: Record<string, string>;
  private readonly fetch: FetchLike;

  constructor(options: WebDavClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/g, '');
    this.auth = options.auth ?? { mode: 'none' };
    this.headers = options.headers ?? {};
    this.fetch = options.fetch ?? fetch;
  }

  async exists(remotePath: string): Promise<boolean> {
    const response = await this.request(remotePath, { method: 'HEAD' });
    return response.status >= 200 && response.status < 300;
  }

  async uploadAtomic(input: WebDavUploadInput): Promise<WebDavUploadResult> {
    const tempPath = `${input.targetPath}.neuma-${crypto.randomUUID()}.tmp`;
    await this.ensureCollection(parentPath(input.targetPath));
    const put = await this.request(tempPath, {
      method: 'PUT',
      headers: input.contentType ? { 'Content-Type': input.contentType } : {},
      body: input.content,
    });
    await assertWebDav(put, [200, 201, 204]);

    if (input.snapshotPath && (await this.exists(input.targetPath))) {
      await this.ensureCollection(parentPath(input.snapshotPath));
      await this.move(input.targetPath, input.snapshotPath, true);
    }

    await this.move(tempPath, input.targetPath, true);
    return {
      providerId: input.targetPath,
      url: this.url(input.targetPath).toString(),
      snapshotPath: input.snapshotPath,
      restartedFromZero: true,
    };
  }

  async move(
    sourcePath: string,
    destinationPath: string,
    overwrite: boolean,
  ): Promise<void> {
    const response = await this.request(sourcePath, {
      method: 'MOVE',
      headers: {
        Destination: this.url(destinationPath).toString(),
        Overwrite: overwrite ? 'T' : 'F',
      },
    });
    await assertWebDav(response, [200, 201, 204]);
  }

  async ensureCollection(remotePath: string | null): Promise<void> {
    if (!remotePath) return;
    const parts = remotePath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = `${current}/${part}`;
      const response = await this.request(current, { method: 'MKCOL' });
      await assertWebDav(response, [200, 201, 204, 405]);
    }
  }

  private request(remotePath: string, init: RequestInit): Promise<Response> {
    return this.fetch(this.url(remotePath), {
      ...init,
      headers: {
        ...this.authHeaders(),
        ...this.headers,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }

  private url(remotePath: string): URL {
    const normalized = remotePath.replace(/^\/+/g, '');
    return new URL(`${this.baseUrl}/${normalized}`);
  }

  private authHeaders(): Record<string, string> {
    switch (this.auth.mode) {
      case 'basic':
        return {
          Authorization: `Basic ${Buffer.from(
            `${this.auth.username}:${this.auth.password}`,
          ).toString('base64')}`,
        };
      case 'bearer':
        return { Authorization: `Bearer ${this.auth.token}` };
      case 'custom-header':
        return this.auth.headers;
      case 'none':
        return {};
    }
  }
}

async function assertWebDav(
  response: Response,
  expected: readonly number[],
): Promise<void> {
  if (expected.includes(response.status)) return;
  throw new Error(`WebDAV request failed: HTTP ${response.status}`);
}

function parentPath(remotePath: string): string | null {
  const index = remotePath.lastIndexOf('/');
  if (index <= 0) return null;
  return remotePath.slice(0, index);
}
