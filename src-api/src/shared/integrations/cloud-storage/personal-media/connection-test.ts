import { validatePersonalMediaBaseUrl } from './url-policy';

const TEST_TIMEOUT_MS = 8_000;
const PERSONAL_MEDIA_PROVIDERS = new Set(['immich', 'photoprism']);

type FetchLike = typeof fetch;

export interface DesktopConnectionTestResult {
  ok: boolean;
  provider: string;
  status?: number;
  serverInfo?: Record<string, unknown>;
  errorCode?: string;
  lanReachable?: boolean;
}

export interface DesktopConnectionTestOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

interface PersonalMediaConnectionTestInput {
  provider: 'immich' | 'photoprism';
  baseUrl: string;
  apiKey: string;
}

type PersonalMediaParseResult =
  | { ok: true; input: PersonalMediaConnectionTestInput }
  | { ok: false; result: DesktopConnectionTestResult };

export function isPersonalMediaConnectionTestInput(
  value: unknown,
): value is { provider: 'immich' | 'photoprism' } {
  if (!value || typeof value !== 'object') return false;
  const provider = (value as { provider?: unknown }).provider;
  return typeof provider === 'string' && PERSONAL_MEDIA_PROVIDERS.has(provider);
}

export async function testDesktopPersonalMediaConnection(
  value: unknown,
  options: DesktopConnectionTestOptions = {},
): Promise<DesktopConnectionTestResult> {
  const parsed = parsePersonalMediaInput(value);
  if (!parsed.ok) {
    return parsed.result;
  }
  const { input } = parsed;

  const baseUrlResult = validatePersonalMediaBaseUrl(input.baseUrl, {
    allowLan: true,
  });
  if (!baseUrlResult.valid) {
    return {
      ok: false,
      provider: input.provider,
      errorCode: normalizeBaseUrlError(baseUrlResult.reason),
      lanReachable: baseUrlResult.lanReachable,
    };
  }

  const url = new URL(
    input.provider === 'immich' ? '/api/server/ping' : '/api/v1/status',
    input.baseUrl,
  );
  const headers: Record<string, string> =
    input.provider === 'immich'
      ? { 'x-api-key': input.apiKey }
      : { Authorization: `Bearer ${input.apiKey}` };

  return testFetch(input.provider, url, {
    fetchFn: options.fetchFn ?? fetch,
    headers,
    lanReachable: baseUrlResult.lanReachable,
    timeoutMs: options.timeoutMs ?? TEST_TIMEOUT_MS,
  });
}

function parsePersonalMediaInput(value: unknown): PersonalMediaParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      result: {
        ok: false,
        provider: 'unknown',
        errorCode: 'invalid_request',
      },
    };
  }

  const provider = parseString(value.provider);
  if (provider !== 'immich' && provider !== 'photoprism') {
    return {
      ok: false,
      result: {
        ok: false,
        provider: provider ?? 'unknown',
        errorCode: 'unsupported_provider',
      },
    };
  }

  const baseUrl = parseString(value.baseUrl);
  const apiKey = parseString(value.apiKey);
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      result: { ok: false, provider, errorCode: 'missing_credentials' },
    };
  }

  return { ok: true, input: { provider, baseUrl, apiKey } };
}

async function testFetch(
  provider: 'immich' | 'photoprism',
  url: URL,
  options: {
    fetchFn: FetchLike;
    headers: Record<string, string>;
    lanReachable?: boolean;
    timeoutMs: number;
  },
): Promise<DesktopConnectionTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchFn(url, {
      headers: options.headers,
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        provider,
        status: response.status,
        errorCode: 'redirect_blocked',
        lanReachable: options.lanReachable,
      };
    }

    const serverInfo = await readJsonObject(response);
    return {
      ok: response.ok,
      provider,
      status: response.status,
      serverInfo: normalizeServerInfo(provider, serverInfo),
      errorCode: response.ok ? undefined : errorCodeForStatus(response.status),
      lanReachable: options.lanReachable,
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      errorCode: isAbortError(error) ? 'timeout' : 'network_error',
      lanReachable: options.lanReachable,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonObject(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;

  const body = (await response.json().catch(() => undefined)) as unknown;
  return isRecord(body) ? body : undefined;
}

function errorCodeForStatus(status: number): string {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'provider_unavailable' : 'provider_error';
}

function normalizeBaseUrlError(reason?: string): string {
  return reason === 'invalid_url'
    ? 'invalid_base_url'
    : (reason ?? 'invalid_base_url');
}

function normalizeServerInfo(
  provider: 'immich' | 'photoprism',
  serverInfo: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (
    provider !== 'immich' ||
    !serverInfo ||
    typeof serverInfo.serverVersion === 'string'
  ) {
    return serverInfo;
  }

  return typeof serverInfo.version === 'string'
    ? { ...serverInfo, serverVersion: serverInfo.version }
    : serverInfo;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
