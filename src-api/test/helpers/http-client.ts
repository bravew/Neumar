import { expect } from 'vitest';

import { parseSSEText } from './stream';

interface JsonResponse {
  status: number;
  json: unknown;
  headers: Headers;
}

async function requestJson(
  method: string,
  baseUrl: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<JsonResponse> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, init);
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

export const postJson = (
  baseUrl: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => requestJson('POST', baseUrl, path, body, headers);

export const putJson = (
  baseUrl: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => requestJson('PUT', baseUrl, path, body, headers);

export const deleteJson = (
  baseUrl: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => requestJson('DELETE', baseUrl, path, body, headers);

export const post = (baseUrl: string, path: string) =>
  requestJson('POST', baseUrl, path);

export async function getJson(
  baseUrl: string,
  path: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export function expect4xx(status: number) {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
}

export async function collectSSE(
  baseUrl: string,
  path: string,
  opts?: { timeoutMs?: number },
): Promise<unknown[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? 30_000,
  );

  try {
    const res = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const text = await res.text();
    return parseSSEText(text);
  } finally {
    clearTimeout(timeout);
  }
}
