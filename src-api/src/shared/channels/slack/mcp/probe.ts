/**
 * Connection probe for user-supplied MCP server URLs.
 *
 * Used after add-time (asynchronously, after the modal closes) to verify
 * a server is reachable and speaks MCP. Runs only HTTP/SSE transports —
 * stdio servers cannot be probed safely from a Slack-triggered modal
 * because we'd be spawning a process the user can't observe.
 *
 * **Why async-of-modal**: per Slack's 3-second `ack()` budget
 * (https://docs.slack.dev/tools/bolt-python/concepts/acknowledge/), a
 * probe that hits a remote server can blow the budget when the server is
 * slow. The submit handler now inserts the row in `enabled = false`
 * state, ack()s immediately, and runs this probe in the background — see
 * `home/index.ts`. On success the row is enabled; on failure the row is
 * deleted and the user gets a DM with the reason.
 *
 * **MCP protocol**: per
 * https://modelcontextprotocol.io/docs/learn/architecture every server
 * expects an `initialize` handshake before `tools/list`. We do
 * `initialize` first; if that succeeds we follow with `tools/list` as a
 * sanity check. Servers that accept `tools/list` directly (lenient
 * implementations like Slack's mcp.slack.com) still pass — we just skip
 * the lookup if the initialize response already proves the contract.
 *
 * Probe failures never log the URL or headers (could include tokens).
 */

import { validateBaseUrl } from '@/shared/utils/url-validator';

const PROBE_TIMEOUT_MS = 8_000;
const PROTOCOL_VERSION = '2025-03-26';

export type ProbeResult =
  | { ok: true; toolCount: number | null }
  | { ok: false; reason: string };

/**
 * Strip header values out of a probe-failure reason string. Some MCP
 * servers reflect the request's `Authorization` value into their error
 * payload ("invalid token: Bearer ghp_xxx"); without scrubbing, that
 * token would be forwarded into the user's Slack DM.
 */
function scrubSecrets(
  result: { ok: false; reason: string; softInitNeeded?: boolean },
  headers: Record<string, string> | undefined,
): { ok: false; reason: string; softInitNeeded?: boolean } {
  if (!headers) return result;
  let reason = result.reason;
  for (const value of Object.values(headers)) {
    if (!value || value.length < 8) continue;
    reason = reason.replaceAll(value, '«redacted»');
  }
  return { ...result, reason };
}

export async function probeHttpMcp(args: {
  url: string;
  headers?: Record<string, string>;
}): Promise<ProbeResult> {
  const guard = validateBaseUrl(args.url);
  if (!guard.valid) return { ok: false, reason: guard.reason ?? 'invalid URL' };

  // Whole-probe budget — initialize + (optional) tools/list together.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const init = await rpc(args.url, args.headers, controller.signal, {
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'neumar-slack-home-probe', version: '1' },
      },
    });
    if (!init.ok) return scrubSecrets(init, args.headers);

    // Server accepted initialize. Try tools/list to confirm the tool surface
    // — servers that haven't received the `notifications/initialized`
    // follow-up may reject this with -32002 ("session not initialized");
    // treat that as a soft pass since the URL + auth are clearly working.
    const list = await rpc(args.url, args.headers, controller.signal, {
      method: 'tools/list',
      params: {},
    });
    if (list.ok) return list;
    if (list.softInitNeeded) return { ok: true, toolCount: null };
    return scrubSecrets(list, args.headers);
  } finally {
    clearTimeout(timer);
  }
}

interface RpcCall {
  method: string;
  params: Record<string, unknown>;
}

type RpcOutcome =
  | { ok: true; toolCount: number | null }
  | { ok: false; reason: string; softInitNeeded?: boolean };

async function rpc(
  url: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  call: RpcCall,
): Promise<RpcOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(headers ?? {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...call }),
      signal,
    });
  } catch (err) {
    const name = (err as Error & { name?: string }).name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { ok: false, reason: 'connection timed out' };
    }
    return { ok: false, reason: 'could not reach the URL' };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason: `server returned HTTP ${res.status} — check the auth header`,
    };
  }
  if (!res.ok) {
    return { ok: false, reason: `server returned HTTP ${res.status}` };
  }

  let json: unknown;
  try {
    const text = await res.text();
    json = parseJsonOrSseFirstFrame(text);
  } catch {
    return { ok: false, reason: 'invalid response body' };
  }

  const env = json as
    | {
        result?: { tools?: Array<{ name?: string }>; protocolVersion?: string };
        error?: { code?: number; message?: string };
      }
    | null
    | undefined;

  if (env?.error) {
    const message = env.error.message ?? 'unknown';
    // -32002 = "Server not initialized" per JSON-RPC convention used by
    // several MCP server impls. Treat as soft-pass for tools/list only.
    const softInitNeeded =
      call.method === 'tools/list' &&
      (env.error.code === -32002 || /not.*initialized/i.test(message));
    return { ok: false, reason: `server error: ${message}`, softInitNeeded };
  }

  if (call.method === 'initialize') {
    if (!env?.result?.protocolVersion) {
      return { ok: false, reason: 'response missing protocolVersion' };
    }
    return { ok: true, toolCount: null };
  }

  if (!env?.result?.tools || !Array.isArray(env.result.tools)) {
    return { ok: false, reason: 'response did not contain a tools array' };
  }
  return { ok: true, toolCount: env.result.tools.length };
}

/**
 * MCP servers may return either a single JSON envelope or an SSE stream
 * with a `data: { … }` first frame. Accept both. Returns null if neither
 * shape parses.
 */
function parseJsonOrSseFirstFrame(body: string): unknown {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  // SSE: lines starting with `data: ` separated by blank lines.
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (payload && payload !== '[DONE]') return JSON.parse(payload);
    }
  }
  return null;
}
