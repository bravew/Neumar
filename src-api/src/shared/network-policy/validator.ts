/**
 * Async, DNS-bound request-target validator.
 *
 * Replaces the previous synchronous `validateBaseUrl()` — sync validation
 * cannot defend against DNS rebinding because the resolved IP at validate
 * time may not be the IP at connect time. `validateRequestTarget()` returns
 * resolved IPs the caller should pin into the actual fetch.
 *
 * Pipeline (in order):
 *   1. Parse via WHATWG URL (normalizes octal/hex/dword IPv4, IDN).
 *   2. Reject userinfo (credentials in URL), unsupported protocols.
 *   3. Strip IPv6 brackets, classify if literal IP.
 *   4. If hostname is a literal IP → classify directly.
 *   5. Otherwise resolve via dns.lookup(all=true) and classify EVERY answer.
 *      Any single private/metadata answer fails the validation.
 *   6. Match against policy egress rules (host/method/port/path).
 *   7. Return ValidationResult with the IPs the caller should connect to.
 */

import { lookup } from 'node:dns/promises';

import { normalizeHost } from './host';
import { classifyIp } from './ip';
import type { NetworkEgressRule, NetworkPolicy } from './schema';

export interface ValidateRequestTargetInput {
  url: string;
  method?: string;
}

export interface ValidateRequestTargetOptions {
  /**
   * Override the resolver. Useful for tests; defaults to `dns.lookup` (system
   * resolver) which respects /etc/hosts. The validator passes `all: true` so
   * EVERY answer is classified.
   */
  resolve?: (
    hostname: string,
  ) => Promise<Array<{ address: string; family: number }>>;
}

export type ValidationDecision = 'allow' | 'deny';

export interface ValidationResult {
  decision: ValidationDecision;
  reason: string;
  /**
   * IPs the caller should connect to, in the order the resolver returned
   * them. Empty for literal-IP URLs (the host is itself the IP).
   */
  resolvedIps: string[];
  /** Normalized URL details — convenient for downstream pinning and audit. */
  normalized: {
    protocol: string;
    host: string;
    hostname: string;
    port: string;
    pathname: string;
    method: string;
  };
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.google',
]);

function hostMatches(pattern: string, host: string): boolean {
  if (pattern === '*' || pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const tail = pattern.slice(1); // ".example.com"
    return host.endsWith(tail) && host.length > tail.length;
  }
  return false;
}

function portMatches(
  rulePorts: NetworkEgressRule['ports'],
  port: number,
): boolean {
  for (const p of rulePorts) {
    if (p === '*') return true;
    if (p === port) return true;
  }
  return false;
}

function pathMatches(rulePaths: string[], pathname: string): boolean {
  return rulePaths.some((prefix) => pathname.startsWith(prefix));
}

function methodMatches(
  ruleMethods: NetworkEgressRule['methods'],
  method: string,
): boolean {
  return ruleMethods.includes(
    method.toUpperCase() as NetworkEgressRule['methods'][number],
  );
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

function isLocalhostHost(host: string): boolean {
  if (host === 'localhost') return true;
  const info = classifyIp(host);
  // Only direct loopback (127/8 or ::1) counts as localhost; IPv4-mapped
  // IPv6 forms are excluded so they cannot ride the localhost exception.
  return !!info && info.classification === 'loopback' && !info.isIpv4Mapped;
}

async function resolveAll(
  hostname: string,
  options?: ValidateRequestTargetOptions,
): Promise<Array<{ address: string; family: number }>> {
  if (options?.resolve) return options.resolve(hostname);
  const answers = await lookup(hostname, { all: true });
  return answers.map((a) => ({ address: a.address, family: a.family }));
}

/**
 * Validate a request target against a network policy. Resolves DNS just
 * before returning — the caller is expected to connect to one of the
 * `resolvedIps` and re-validate before each redirect hop.
 */
export async function validateRequestTarget(
  input: ValidateRequestTargetInput,
  policy: NetworkPolicy,
  options?: ValidateRequestTargetOptions,
): Promise<ValidationResult> {
  const method = (input.method ?? 'GET').toUpperCase();

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return {
      decision: 'deny',
      reason: 'Invalid URL format',
      resolvedIps: [],
      normalized: {
        protocol: '',
        host: '',
        hostname: '',
        port: '',
        pathname: '',
        method,
      },
    };
  }

  const rawHost = normalizeHost(parsed.hostname);
  const normalized = {
    protocol: parsed.protocol,
    host: parsed.host,
    hostname: rawHost,
    port: parsed.port,
    pathname: parsed.pathname || '/',
    method,
  };

  if (parsed.username !== '' || parsed.password !== '') {
    return {
      decision: 'deny',
      reason: 'Credentials in URL are not permitted',
      resolvedIps: [],
      normalized,
    };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      decision: 'deny',
      reason: `Unsupported protocol: ${parsed.protocol}`,
      resolvedIps: [],
      normalized,
    };
  }

  const port =
    parsed.port === '' ? defaultPort(parsed.protocol) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      decision: 'deny',
      reason: `Invalid port: ${parsed.port}`,
      resolvedIps: [],
      normalized,
    };
  }

  const localhost = isLocalhostHost(rawHost);

  // Localhost dev exception — only when policy explicitly allows it.
  if (localhost) {
    if (!policy.allow_localhost) {
      return {
        decision: 'deny',
        reason: 'Localhost is not allowed by this policy',
        resolvedIps: [],
        normalized,
      };
    }
    return {
      decision: 'allow',
      reason: 'localhost (policy.allow_localhost = true)',
      resolvedIps: [],
      normalized,
    };
  }

  const literalIp = classifyIp(rawHost);
  let resolvedIps: string[] = [];

  if (literalIp) {
    if (literalIp.isIpv4Mapped) {
      return {
        decision: 'deny',
        reason: `IPv4-mapped IPv6 literal rejected (smuggling defense): ${literalIp.address}`,
        resolvedIps: [literalIp.address],
        normalized,
      };
    }
    if (
      (policy.dns.block_metadata && literalIp.isMetadata) ||
      (policy.dns.block_private && literalIp.isPrivateOrSpecial)
    ) {
      return {
        decision: 'deny',
        reason: `IP literal is ${literalIp.classification}`,
        resolvedIps: [literalIp.address],
        normalized,
      };
    }
    resolvedIps = [literalIp.address];
  } else {
    if (policy.dns.block_metadata && METADATA_HOSTNAMES.has(rawHost)) {
      return {
        decision: 'deny',
        reason: `Hostname is a metadata endpoint: ${rawHost}`,
        resolvedIps: [],
        normalized,
      };
    }

    let answers: Array<{ address: string; family: number }>;
    try {
      answers = await resolveAll(rawHost, options);
    } catch (err) {
      return {
        decision: 'deny',
        reason: `DNS resolution failed: ${(err as Error).message}`,
        resolvedIps: [],
        normalized,
      };
    }

    if (answers.length === 0) {
      return {
        decision: 'deny',
        reason: 'DNS returned no answers',
        resolvedIps: [],
        normalized,
      };
    }

    // Classify EVERY answer — DNS rebinding defense.
    for (const a of answers) {
      const info = classifyIp(a.address);
      if (!info) {
        return {
          decision: 'deny',
          reason: `DNS answer not parseable: ${a.address}`,
          resolvedIps: answers.map((x) => x.address),
          normalized,
        };
      }
      if (policy.dns.block_metadata && info.isMetadata) {
        return {
          decision: 'deny',
          reason: `DNS answer ${a.address} is a metadata IP`,
          resolvedIps: answers.map((x) => x.address),
          normalized,
        };
      }
      if (policy.dns.block_private && info.isPrivateOrSpecial) {
        return {
          decision: 'deny',
          reason: `DNS answer ${a.address} is ${info.classification}`,
          resolvedIps: answers.map((x) => x.address),
          normalized,
        };
      }
    }

    resolvedIps = answers.map((a) => a.address);
  }

  // At this point the destination IP set is safe. Apply egress rules.
  if (policy.egress.length === 0) {
    if (policy.default === 'allow') {
      return {
        decision: 'allow',
        reason: 'matched default=allow (no egress rules)',
        resolvedIps,
        normalized,
      };
    }
    return {
      decision: 'deny',
      reason: 'default=deny and no egress rules matched',
      resolvedIps,
      normalized,
    };
  }

  for (const rule of policy.egress) {
    if (!hostMatches(rule.host, rawHost)) continue;
    if (!portMatches(rule.ports, port)) continue;
    if (!methodMatches(rule.methods, method)) continue;
    if (!pathMatches(rule.paths, normalized.pathname)) continue;
    return {
      decision: 'allow',
      reason: `matched egress rule "${rule.name}"`,
      resolvedIps,
      normalized,
    };
  }

  if (policy.default === 'allow') {
    return {
      decision: 'allow',
      reason: 'no egress rule matched but default=allow',
      resolvedIps,
      normalized,
    };
  }
  return {
    decision: 'deny',
    reason: 'no matching egress rule (default=deny)',
    resolvedIps,
    normalized,
  };
}
