/**
 * Policy-bound HTTP/HTTPS fetch.
 *
 * The platform `fetch()` and most popular HTTP clients follow redirects
 * automatically. That breaks SSRF defense: a TOCTOU window opens between
 * pre-flight URL validation and the second-hop request, which the validator
 * never sees. `safeFetch()` closes that window:
 *
 *   - Every hop is validated by `validateRequestTarget()` immediately before
 *     `connect()`, so DNS rebinding and redirect smuggling are denied per-hop.
 *   - Connections are pinned to the IP returned by the validator (via the
 *     undocumented but stable `lookup` hook on `http.request`) — the kernel
 *     does not get to re-resolve under us.
 *   - Redirects are followed manually, bounded by `maxRedirects`. Each
 *     redirect target is re-validated through the same pipeline.
 *   - Short hard timeouts. No automatic retries.
 *   - `node:http` / `node:https` only. Adding `undici` here would re-introduce
 *     opaque redirect handling.
 */

import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';

import { recordNetworkPolicyAudit } from '@/shared/security/audit';
import { containsCanary } from '@/shared/security/canary';
import type { SecuritySession } from '@/shared/security/session';

import type { NetworkPolicy } from './schema';
import { validateRequestTarget } from './validator';

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Hard ceiling per-hop. Default 15s. */
  timeoutMs?: number;
  /** Maximum redirects to follow. Default 5. */
  maxRedirects?: number;
  /** Maximum buffered response body size in bytes. Unbounded by default. */
  maxBytes?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
  /**
   * SecuritySession for audit correlation and canary detection. If provided,
   * the canary is scanned against URL/headers/body of every outgoing hop and
   * the request is blocked if a leak is detected.
   */
  session?: SecuritySession;
}

export interface SafeFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** Final URL after redirect chain. */
  finalUrl: string;
  /** Each URL we visited, in order. Useful for audit. */
  redirectChain: string[];
}

export class NetworkPolicyDenied extends Error {
  readonly reason: string;
  readonly url: string;
  constructor(url: string, reason: string) {
    super(`Network policy denied ${url}: ${reason}`);
    this.name = 'NetworkPolicyDenied';
    this.reason = reason;
    this.url = url;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

function lowercaseHeaders(
  raw: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

function pickIpFamily(ip: string): 4 | 6 {
  return ip.includes(':') ? 6 : 4;
}

type LookupCallback =
  | ((
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void)
  | ((
      err: NodeJS.ErrnoException | null,
      addresses: dns.LookupAddress[],
    ) => void);

function normalizeLookupArgs(
  opts: unknown,
  cb: unknown,
): { options: dns.LookupOptions; callback: LookupCallback } {
  if (typeof opts === 'function') {
    return { options: {}, callback: opts as LookupCallback };
  }
  return {
    options: (opts ?? {}) as dns.LookupOptions,
    callback: cb as LookupCallback,
  };
}

function returnPinnedLookupResult(
  pinIp: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
): void {
  const family = pickIpFamily(pinIp);
  if (options.all === true) {
    (
      callback as (
        err: NodeJS.ErrnoException | null,
        addresses: dns.LookupAddress[],
      ) => void
    )(null, [{ address: pinIp, family }]);
    return;
  }
  (
    callback as (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void
  )(null, pinIp, family);
}

export function createPinnedLookup(
  pinIp: string | null,
): NonNullable<https.RequestOptions['lookup']> {
  return (_hostname: string, opts: unknown, cb?: unknown) => {
    const { options: lookupOptions, callback } = normalizeLookupArgs(opts, cb);
    if (pinIp) {
      returnPinnedLookupResult(pinIp, lookupOptions, callback);
    } else {
      // For URLs whose hostname is itself a literal IP, opts may be a
      // function on older Node lines; fall back to default lookup.
      dns.lookup(
        _hostname,
        lookupOptions,
        callback as (
          err: NodeJS.ErrnoException | null,
          address: string | dns.LookupAddress[],
          family: number,
        ) => void,
      );
    }
  };
}

function tryParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

interface InternalRequestArgs {
  url: URL;
  pinIp: string | null;
  options: SafeFetchOptions;
}

function performHop({ url, pinIp, options }: InternalRequestArgs): Promise<{
  res: http.IncomingMessage;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (value: {
      res: http.IncomingMessage;
      body: Buffer;
    }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const reqOptions: https.RequestOptions = {
      method: (options.method ?? 'GET').toUpperCase(),
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        host: url.host, // ensure SNI/Host stays the original hostname
        ...options.headers,
      },
      // Pin the destination IP. Node's `lookup` is the stable injection point
      // for both http and https requests. Returning the pre-validated IP
      // prevents the OS resolver from re-resolving differently at connect.
      lookup: createPinnedLookup(pinIp),
      // For TLS, validate the original hostname against the cert (default
      // behavior). We are only pinning the IP, not bypassing certificate
      // verification.
    };

    const req = lib.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      res.on('data', (chunk: Buffer) => {
        if (settled) return;
        totalBytes += chunk.byteLength;
        if (options.maxBytes !== undefined && totalBytes > options.maxBytes) {
          settleReject(
            new Error(`Response exceeded ${options.maxBytes} bytes`),
          );
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => settleResolve({ res, body: Buffer.concat(chunks) }));
      res.on('error', settleReject);
    });

    req.on('error', settleReject);

    const timeoutId = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    req.on('close', () => clearTimeout(timeoutId));

    if (options.signal) {
      const onAbort = () => req.destroy(new Error('Request aborted'));
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/**
 * Resolve a possibly-relative redirect target against the previous URL.
 */
function resolveRedirect(prevUrl: string, location: string): string {
  return new URL(location, prevUrl).toString();
}

/**
 * Policy-bound fetch with manual redirect validation and DNS pinning.
 *
 * Throws `NetworkPolicyDenied` for any denied hop. Returns a successful
 * response only when every hop in the redirect chain was validated.
 */
function detectCanaryInRequest(
  url: string,
  headers: Record<string, string> | undefined,
  body: string | Buffer | undefined,
  token: string,
): boolean {
  if (containsCanary(token, url)) return true;
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (containsCanary(token, k)) return true;
      if (containsCanary(token, v)) return true;
    }
  }
  if (body !== undefined) return containsCanary(token, body);
  return false;
}

export async function safeFetch(
  url: string,
  policy: NetworkPolicy,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const redirectChain: string[] = [];
  const session = options.session;
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    redirectChain.push(currentUrl);

    // Canary scan BEFORE we let the request leave the host. We cannot rely on
    // post-hoc audit because the leak has already occurred by then.
    if (session) {
      const leak = detectCanaryInRequest(
        currentUrl,
        options.headers,
        options.body,
        session.canary.value,
      );
      if (leak) {
        const parsed = tryParseUrl(currentUrl);
        recordNetworkPolicyAudit({
          sessionId: session.sessionId,
          taskId: session.taskId,
          decision: 'canary_blocked',
          reason: 'canary token detected in outbound request',
          method: options.method,
          host: parsed?.hostname,
          port: parsed?.port ? Number(parsed.port) : undefined,
          scheme: parsed?.protocol,
          redirectChain,
          canaryHit: true,
          metadata: { fingerprint: session.canary.fingerprint },
        });
        session.audit.recordEvent({
          eventType: 'network.canary_leak',
          severity: 'critical',
          source: 'safeFetch',
          action: 'block',
          redactedSnippet: `canary fingerprint=${session.canary.fingerprint} on ${parsed?.host ?? '<unparseable>'}`,
        });
        throw new NetworkPolicyDenied(
          currentUrl,
          'canary token detected in outbound request',
        );
      }
    }

    const validation = await validateRequestTarget(
      { url: currentUrl, method: options.method },
      policy,
    );

    const parsed = tryParseUrl(currentUrl);
    const auditCommon = {
      sessionId: session?.sessionId,
      taskId: session?.taskId,
      method: options.method,
      host: parsed?.hostname,
      port: parsed?.port
        ? Number(parsed.port)
        : parsed?.protocol === 'https:'
          ? 443
          : parsed?.protocol === 'http:'
            ? 80
            : undefined,
      scheme: parsed?.protocol,
      resolvedIp: validation.resolvedIps[0],
      redirectChain: [...redirectChain],
      metadata: { reason: validation.reason },
    };

    if (validation.decision === 'deny') {
      recordNetworkPolicyAudit({
        ...auditCommon,
        decision: hop > 0 ? 'redirect_blocked' : 'deny',
        reason: validation.reason,
      });
      throw new NetworkPolicyDenied(currentUrl, validation.reason);
    }

    recordNetworkPolicyAudit({ ...auditCommon, decision: 'allow' });

    const pinIp = validation.resolvedIps[0] ?? null;

    if (!parsed) {
      // validateRequestTarget would have denied an unparseable URL, so this
      // is an internal invariant violation rather than a user-facing error.
      throw new NetworkPolicyDenied(
        currentUrl,
        'unparseable URL after validation',
      );
    }

    let res: http.IncomingMessage;
    let body: Buffer;
    try {
      ({ res, body } = await performHop({
        url: parsed,
        pinIp,
        options,
      }));
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('timed out')) {
        recordNetworkPolicyAudit({
          ...auditCommon,
          decision: 'timeout',
          reason: message,
        });
      }
      throw err;
    }

    const status = res.statusCode ?? 0;
    const headers = lowercaseHeaders(res.headers);

    const location = headers['location'];
    const isRedirect =
      status >= 300 && status < 400 && status !== 304 && location;

    if (!isRedirect) {
      return {
        status,
        headers,
        body,
        finalUrl: currentUrl,
        redirectChain,
      };
    }

    if (hop >= maxRedirects) {
      throw new NetworkPolicyDenied(
        currentUrl,
        `Too many redirects (>${maxRedirects})`,
      );
    }

    currentUrl = resolveRedirect(currentUrl, location!);
  }

  // Unreachable (loop bound), but keeps TS happy.
  throw new NetworkPolicyDenied(url, 'redirect loop fell through');
}

export interface SafeFetchStreamOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Hard ceiling per-hop. Default 60s for streaming responses. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SafeFetchStreamResponse {
  status: number;
  headers: Record<string, string>;
  /**
   * The raw Node response stream. Consumers MUST drain or destroy it to free
   * the underlying socket. Use `getReader()` via `Readable.toWeb(stream)` if
   * web-stream semantics are needed.
   */
  stream: http.IncomingMessage;
  finalUrl: string;
}

/**
 * Streaming variant of `safeFetch` for SSE and other long-running responses.
 * Same DNS pinning + per-hop validation, but returns the response as a Node
 * readable stream instead of a buffered body. Redirects are NOT followed —
 * a streaming response that 3xx-redirects is unusual; callers can re-issue.
 */
export async function safeFetchStream(
  url: string,
  policy: NetworkPolicy,
  options: SafeFetchStreamOptions = {},
): Promise<SafeFetchStreamResponse> {
  const validation = await validateRequestTarget(
    { url, method: options.method },
    policy,
  );
  const parsed = tryParseUrl(url);
  if (validation.decision === 'deny' || !parsed) {
    throw new NetworkPolicyDenied(
      url,
      validation.decision === 'deny'
        ? validation.reason
        : 'unparseable URL after validation',
    );
  }

  const pinIp = validation.resolvedIps[0] ?? null;
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return new Promise<SafeFetchStreamResponse>((resolve, reject) => {
    const req = lib.request(
      {
        method: (options.method ?? 'GET').toUpperCase(),
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          host: parsed.host,
          ...options.headers,
        },
        lookup: createPinnedLookup(pinIp),
      },
      (res) => {
        // Reject redirects — callers who need them must use safeFetch.
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && status !== 304) {
          res.resume();
          reject(
            new NetworkPolicyDenied(
              url,
              `Streaming response received redirect ${status}; not followed`,
            ),
          );
          return;
        }
        resolve({
          status,
          headers: lowercaseHeaders(res.headers),
          stream: res,
          finalUrl: url,
        });
      },
    );

    req.on('error', reject);

    const timeoutId = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    req.on('close', () => clearTimeout(timeoutId));

    if (options.signal) {
      const onAbort = () => req.destroy(new Error('Request aborted'));
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}
