/**
 * Per-session local egress proxy — interface placeholder.
 *
 * Phase 7 expects this to be a small HTTP CONNECT / SOCKS proxy bound to
 * 127.0.0.1:<random> per SecuritySession, where the sandbox provider allows
 * exactly one outbound socket and that socket is the proxy. Every request
 * the child issues is then validated through `validateRequestTarget()` and
 * scanned for the session canary before being forwarded. This is the only
 * way to claim hard egress isolation when the sandbox itself can't filter.
 *
 * The actual proxy server isn't implemented yet because no provider in this
 * tree currently routes through it — Codex sandbox blocks localhost,
 * NativeProvider runs in-process, and ASRT has its own egress hook. The
 * interface below documents what the proxy must do so the integration site
 * is clear when one of those providers grows a "single allowed socket" mode.
 *
 * When the implementation lands, follow these rules:
 *   - Bind 127.0.0.1 only. Never 0.0.0.0.
 *   - Validate Host/SNI on every CONNECT and every plain HTTP request via
 *     `validateRequestTarget()`. Don't rely on a single startup check.
 *   - For HTTPS, intercept only at the CONNECT layer (host:port). Do NOT
 *     terminate TLS — the proxy must not be able to read the body.
 *   - For HTTP, scan URL/path/headers/body for the session canary BEFORE
 *     forwarding; refuse the request on hit.
 *   - Emit recordNetworkPolicyAudit() on every decision (allow/deny/redirect/
 *     timeout/canary_blocked).
 *   - Treat the proxy as untrusted itself — fail closed if the upstream
 *     validation throws.
 */

import type { SecuritySession } from '@/shared/security/session';

import type { NetworkPolicy } from './schema';

export interface EgressProxy {
  /** Listening URL (e.g. `http://127.0.0.1:54213`). */
  readonly url: string;
  /** SecuritySession the proxy is bound to. */
  readonly session: SecuritySession;
  /** Stop the proxy and release the port. */
  stop(): Promise<void>;
}

export interface StartEgressProxyOptions {
  policy: NetworkPolicy;
  session: SecuritySession;
}

/**
 * Start a per-session egress proxy. NOT YET IMPLEMENTED — see file header.
 *
 * Throws so a caller wiring this up prematurely fails loudly instead of
 * silently routing traffic through nothing.
 */
export function startEgressProxy(
  _opts: StartEgressProxyOptions,
): Promise<EgressProxy> {
  throw new Error(
    'startEgressProxy is not yet implemented. ' +
      'Provider integration (sandbox single-socket mode) lands before the proxy server.',
  );
}
