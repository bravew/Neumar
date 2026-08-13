import { ConnectorServiceError, mapComposioHttpError } from './errors';

export interface ComposioClientOptions {
  apiKeyProvider: () => string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ComposioClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ComposioClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://backend.composio.dev';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.requestJson<T>('GET', path, undefined, signal);
  }

  async postJson<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.requestJson<T>('POST', path, body, signal);
  }

  async patchJson<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.requestJson<T>('PATCH', path, body, signal);
  }

  async deleteJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.requestJson<T>('DELETE', path, undefined, signal);
  }

  async requestJson<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const apiKey = this.options.apiKeyProvider();
    if (!apiKey) {
      throw new ConnectorServiceError(
        'CONNECTOR_NOT_CONFIGURED',
        'Configure a Composio API key before using managed connectors.',
      );
    }

    const url = new URL(path, this.baseUrl);
    const init: RequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };

    const first = await this.fetchOnce(url, init, signal);
    if (first.response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        first.response.headers.get('retry-after'),
      );
      await sleep(Math.min(retryAfterMs, 5_000));
      return this.handleResponse<T>(await this.fetchOnce(url, init, signal));
    }

    return this.handleResponse<T>(first);
  }

  private async fetchOnce(
    url: URL,
    init: RequestInit,
    externalSignal?: AbortSignal,
  ): Promise<{ response: Response; body: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromExternal = () => controller.abort();

    try {
      if (externalSignal?.aborted) controller.abort();
      externalSignal?.addEventListener('abort', abortFromExternal, {
        once: true,
      });
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      const body = await parseJsonResponse(response);
      return { response, body };
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }

  private handleResponse<T>(result: { response: Response; body: unknown }): T {
    if (!result.response.ok) {
      throw mapComposioHttpError(result.response.status, result.body);
    }
    return result.body as T;
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function parseRetryAfterMs(value: string | null): number {
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return 1_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
