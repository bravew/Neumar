import { API_BASE_URL } from '@/config';

export interface TestResult {
  ok: boolean;
  provider: string;
  status?: number;
  serverInfo?: Record<string, unknown>;
  errorCode?: string;
  lanReachable?: boolean;
}

export const IMMICH_SAFE_VERSION = '2.4.1';

export function requestConnectionTest(
  provider: 'immich' | 'photoprism',
  baseUrl: string,
  apiKey: string,
): Promise<TestResult> {
  return postJson<TestResult>('/connections/test', {
    provider,
    baseUrl,
    apiKey,
  });
}

export function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal });
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, { method: 'POST', body });
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, { method: 'PATCH', body });
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

export function getServerVersion(
  result: TestResult | null,
): string | undefined {
  if (!result?.serverInfo) return undefined;
  return stringValue(
    result.serverInfo.serverVersion ?? result.serverInfo.version,
  );
}

export function compareSemver(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < Math.max(a.release.length, b.release.length); i += 1) {
    const delta = (a.release[i] ?? 0) - (b.release[i] ?? 0);
    if (delta !== 0) return delta;
  }
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return 0;
}

async function requestJson<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/cloud-storage${path}`, {
    method: options.method,
    signal: options.signal,
    headers:
      options.body === undefined
        ? undefined
        : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function parseVersion(version: string): {
  release: number[];
  prerelease: boolean;
} {
  const [core = '', pre] = version.split('-', 2);
  return {
    release: core
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part)),
    prerelease: pre !== undefined && pre.length > 0,
  };
}
