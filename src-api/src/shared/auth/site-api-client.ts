import {
  CloudStorageError,
  errorCodeFromStatus,
  normalizeErrorCode,
} from '@/shared/integrations/cloud-storage/errors';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import { getSiteSession, getSiteUrl, refreshSiteToken } from './site-auth';

const logger = createLogger('SiteApiClient');
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 2_000;
const CLIENT_VERSION = process.env.npm_package_version ?? '0.0.0';

type FetchLike = typeof fetch;

export interface SiteApiClientOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
  maxRetryAfterMs?: number;
  sessionProvider?: typeof getSiteSession;
  refreshProvider?: typeof refreshSiteToken;
}

export class SiteApiClient {
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly sessionProvider: typeof getSiteSession;
  private readonly refreshProvider: typeof refreshSiteToken;

  constructor(options: SiteApiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? MAX_RETRY_AFTER_MS;
    this.sessionProvider = options.sessionProvider ?? getSiteSession;
    this.refreshProvider = options.refreshProvider ?? refreshSiteToken;
  }

  async getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, { ...init, method: 'GET' });
    return (await response.json()) as T;
  }

  async postJson<T>(
    path: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.request(path, {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      body: JSON.stringify(body),
    });
    return (await response.json()) as T;
  }

  async patchJson<T>(
    path: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.request(path, {
      ...init,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      body: JSON.stringify(body),
    });
    return (await response.json()) as T;
  }

  async putJson<T>(
    path: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.request(path, {
      ...init,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      body: JSON.stringify(body),
    });
    return (await response.json()) as T;
  }

  async streamGet(
    path: string,
    init?: RequestInit,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.streamGetResponse(path, init);
    if (!response.body) {
      throw new CloudStorageError(
        'transient_upstream',
        'Missing response body',
      );
    }
    return response.body;
  }

  async streamGetResponse(path: string, init?: RequestInit): Promise<Response> {
    return this.request(path, { ...init, method: 'GET' });
  }

  async putForm<T>(
    path: string,
    formData: FormData,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.request(path, {
      ...init,
      method: 'PUT',
      body: formData,
    });
    return (await response.json()) as T;
  }

  async del<T = void>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, { ...init, method: 'DELETE' });
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async request(
    path: string,
    init: RequestInit,
    retriedAuth = false,
    retriedRateLimit = false,
  ): Promise<Response> {
    const baseUrl = getSiteUrl();
    const urlCheck = validateBaseUrl(baseUrl);
    if (!urlCheck.valid) {
      throw new CloudStorageError(
        'site_unreachable',
        `Invalid site URL: ${urlCheck.reason ?? 'unknown reason'}`,
      );
    }

    const session = await this.sessionProvider();
    if (!session?.accessToken) {
      throw new CloudStorageError('auth_revoked', 'No site session available');
    }

    const response = await this.fetchWithAbort(
      new URL(path, baseUrl).toString(),
      init,
      session.accessToken,
    );

    if (response.status === 401 && !retriedAuth) {
      const refreshed = await this.refreshProvider();
      if (!refreshed?.accessToken) {
        throw new CloudStorageError('auth_revoked', 'Site session expired');
      }
      return this.request(path, init, true, retriedRateLimit);
    }

    if (response.status === 429 && !retriedRateLimit) {
      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
      await delay(Math.min(retryAfterMs, this.maxRetryAfterMs));
      return this.request(path, init, retriedAuth, true);
    }

    if (!response.ok) {
      throw await this.toError(response);
    }

    return response;
  }

  private async fetchWithAbort(
    url: string,
    init: RequestInit,
    accessToken: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const sourceSignal = init.signal;

    const abortFromSource = () => controller.abort(sourceSignal?.reason);
    if (sourceSignal) {
      if (sourceSignal.aborted) abortFromSource();
      else
        sourceSignal.addEventListener('abort', abortFromSource, { once: true });
    }

    try {
      return await this.fetchFn(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
          'X-Neuma-Client': 'desktop',
          'X-Neuma-Client-Version': CLIENT_VERSION,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (sourceSignal?.aborted || controller.signal.aborted) {
        throw error;
      }
      logger.warn('Site request failed', error);
      throw new CloudStorageError('site_unreachable', 'Site is unreachable', {
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
      sourceSignal?.removeEventListener('abort', abortFromSource);
    }
  }

  private async toError(response: Response): Promise<CloudStorageError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    const payload = body && typeof body === 'object' ? body : {};
    const code = normalizeErrorCode((payload as { error?: unknown }).error);
    const message =
      typeof (payload as { message?: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : `Site request failed with ${response.status}`;

    return new CloudStorageError(
      code === 'transient_upstream'
        ? errorCodeFromStatus(response.status)
        : code,
      message,
      {
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
        details: body,
      },
    );
  }
}

export function createSiteApiClient(
  options?: SiteApiClientOptions,
): SiteApiClient {
  return new SiteApiClient(options);
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1_000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
