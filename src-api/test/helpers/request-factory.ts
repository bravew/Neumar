/**
 * Shared request factory for Hono in-process integration tests.
 * Constructs Request objects for use with `app.request()`.
 *
 * NOT for real HTTP E2E tests — use `http-client.ts` (postJson/getJson) for those.
 */

/**
 * Build a Request for Hono's `app.request()`.
 *
 * @param method - HTTP method
 * @param path - URL path (e.g. '/tasks')
 * @param body - JSON body (optional, auto-stringified)
 * @param extraHeaders - Additional headers (e.g. `{ Host: 'localhost' }` for db routes)
 */
export function makeReq(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Request {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body != null) headers['Content-Type'] = 'application/json';
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

/** POST/PUT/PATCH request with JSON body */
export const jsonReq = (path: string, body: unknown, method = 'POST') =>
  makeReq(method, path, body);
