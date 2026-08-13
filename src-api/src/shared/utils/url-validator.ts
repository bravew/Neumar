/**
 * Phase 7 facade — re-export the async, DNS-bound validator so callers can
 * import the new entry point from a stable path.
 */
import { normalizeHost } from '@/shared/network-policy/host';
import { classifyIp } from '@/shared/network-policy/ip';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { validateRequestTarget } from '@/shared/network-policy/validator';

export { validateRequestTarget } from '@/shared/network-policy/validator';
export type {
  ValidationResult as RequestTargetValidationResult,
  ValidateRequestTargetInput,
} from '@/shared/network-policy/validator';
export { safeFetch, NetworkPolicyDenied } from '@/shared/network-policy/fetch';

export async function validateBaseUrlForFetch(
  baseUrl: string,
  method: string = 'GET',
): Promise<{ valid: boolean; reason?: string }> {
  const syncCheck = validateBaseUrl(baseUrl);
  if (!syncCheck.valid) return syncCheck;

  const asyncCheck = await validateRequestTarget(
    { url: baseUrl, method },
    trustedLocalPolicy(),
  );
  if (asyncCheck.decision === 'allow') return { valid: true };
  return { valid: false, reason: asyncCheck.reason };
}

/** Private/internal IP ranges and cloud metadata endpoints to block */
const BLOCKED_HOST_PATTERNS = [
  /^10\.\d+\.\d+\.\d+$/, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/, // 192.168.0.0/16
  /^169\.254\.\d+\.\d+$/, // Link-local / AWS metadata
  /^127\.\d+\.\d+\.\d+$/, // 127.0.0.0/8 full loopback range
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/, // 100.64.0.0/10 CGN
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/, // IPv6 loopback
  /^::$/, // IPv6 unspecified
  /^::ffff:/i, // IPv4-mapped IPv6
  /^\[?fe80:/i, // IPv6 link-local
  /^\[?f[cd][0-9a-f]{2}:/i, // IPv6 unique local (fc00::/7)
];

/** Hostnames that should always be blocked (cloud metadata services) */
const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.google',
  '168.63.129.16', // Azure IMDS
];

/**
 * Synchronous, hostname-only SSRF pre-check. Suitable for UI form hints and
 * defense-in-depth before issuing a fetch, BUT does NOT defend against DNS
 * rebinding — the IP at validate time may not be the IP at connect time.
 *
 * For any code path that actually issues a network request, use
 * `validateRequestTarget()` (and prefer `safeFetch()` from
 * `@/shared/network-policy/fetch`, which validates per-hop and pins DNS).
 *
 * The legacy name is kept to avoid a 21-call-site rename in one diff. Treat
 * this as a hint only; the authoritative check happens at connect time.
 *
 * @deprecated Use `validateRequestTarget()` for any path that issues a fetch.
 */
export function validateBaseUrl(baseUrl: string): {
  valid: boolean;
  reason?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Only allow http/https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const hostname = normalizeHost(parsed.hostname);

  // Allow localhost and 127.0.0.0/8 loopback (for local servers like Ollama)
  if (hostname === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(hostname)) {
    return { valid: true };
  }

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.some((h) => hostname.toLowerCase() === h)) {
    return { valid: false, reason: 'Blocked hostname' };
  }

  // Block private/internal IP ranges
  const literalIp = classifyIp(hostname);
  if (
    BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname)) ||
    (literalIp && literalIp.isPrivateOrSpecial)
  ) {
    return {
      valid: false,
      reason: 'Private or internal IP addresses are not allowed',
    };
  }

  // Block non-HTTPS for non-localhost URLs
  if (parsed.protocol === 'http:') {
    return { valid: false, reason: 'HTTPS required for non-localhost URLs' };
  }

  return { valid: true };
}
