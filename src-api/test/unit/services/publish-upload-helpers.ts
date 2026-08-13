import { vi } from 'vitest';

import type { FetchLike } from '@/shared/services/publish/upload/upload-session';

export interface FetchCall {
  input: string | URL | Request;
  init?: RequestInit;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

export function emptyResponse(
  status = 204,
  headers?: Record<string, string>,
): Response {
  return new Response(null, { status, headers });
}

export function createFetchMock(responses: Response[]): {
  fetch: FetchLike;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      const next = responses.shift();
      if (!next) return new Response('unexpected request', { status: 599 });
      return next;
    },
  ) as FetchLike;
  return { fetch, calls };
}

export function headerValue(
  headers: HeadersInit | undefined,
  name: string,
): string | null {
  return new Headers(headers).get(name);
}
