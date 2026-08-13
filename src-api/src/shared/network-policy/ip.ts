/**
 * IP classification for network policy enforcement.
 *
 * The validator pipeline normalizes any IP we observe — whether typed by the
 * user, returned by `dns.lookup`, or extracted from a URL — through these
 * helpers, so a single decision point covers IPv4, IPv6, IPv4-mapped IPv6,
 * and the various metadata / private / link-local / CGNAT ranges.
 *
 * Node's `net.isIP()` rejects non-RFC strings, so all parsing here uses
 * `net.isIP()` first; we never trust a regex alone. WHATWG URL is responsible
 * for octal/hex/dword normalization at the URL parsing layer — we only see
 * canonical dotted-quad / hex-colon strings here.
 */

import { isIP, isIPv4, isIPv6 } from 'node:net';

export type IpClassification =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'multicast'
  | 'unspecified'
  | 'cgnat'
  | 'metadata'
  | 'broadcast'
  | 'reserved';

export interface IpInfo {
  /** Original string (after IPv4-mapped extraction). */
  address: string;
  family: 'ipv4' | 'ipv6';
  classification: IpClassification;
  /** True if the address falls in any range that should be blocked by default. */
  isPrivateOrSpecial: boolean;
  /** True if the address is a known cloud metadata endpoint. */
  isMetadata: boolean;
  /**
   * True if the input was an IPv4-mapped IPv6 literal (`::ffff:a.b.c.d`).
   * These are blocked everywhere — they are almost always a v4-blocklist
   * smuggling attempt, never a legitimate egress target.
   */
  isIpv4Mapped: boolean;
}

const METADATA_IPV4 = new Set([
  '169.254.169.254', // AWS, GCP, Azure (legacy)
  '169.254.170.2', // AWS ECS task metadata
  '100.100.100.200', // Alibaba Cloud
  '168.63.129.16', // Azure WireServer
]);

const METADATA_IPV6 = new Set([
  // AWS IMDSv2 over IPv6
  'fd00:ec2::254',
]);

function ipv4ToOctets(addr: string): [number, number, number, number] | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    out.push(n);
  }
  return out as [number, number, number, number];
}

function classifyIpv4(addr: string): IpClassification {
  if (METADATA_IPV4.has(addr)) return 'metadata';
  const octets = ipv4ToOctets(addr);
  if (!octets) return 'reserved';
  const [a, b] = octets;

  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link_local';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a >= 224 && a <= 239) return 'multicast';
  // Limited broadcast must be checked before the 240/4 reserved range,
  // since 255 falls inside it.
  if (
    octets[0] === 255 &&
    octets[1] === 255 &&
    octets[2] === 255 &&
    octets[3] === 255
  ) {
    return 'broadcast';
  }
  if (a >= 240) return 'reserved'; // 240/4 reserved
  return 'public';
}

/**
 * Parse the IPv4-mapped portion of an IPv6 address `::ffff:a.b.c.d` or
 * `::ffff:HHHH:HHHH`. Returns null if the address is not IPv4-mapped.
 */
export function extractIpv4Mapped(addr: string): string | null {
  // Compressed dotted-quad form: ::ffff:127.0.0.1
  const lower = addr.toLowerCase();
  const dotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1]!;
  // Hex-colon form: ::ffff:7f00:1
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
  }
  return null;
}

function classifyIpv6Raw(addr: string): IpClassification {
  const lower = addr.toLowerCase();
  if (METADATA_IPV6.has(lower)) return 'metadata';
  if (lower === '::') return 'unspecified';
  if (lower === '::1') return 'loopback';
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::'))
    return 'link_local';
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return 'private'; // ULA fc00::/7
  if (lower.startsWith('ff')) return 'multicast'; // ff00::/8
  return 'public';
}

/**
 * Strip surrounding brackets if present (URL hostname form).
 */
export function stripIpv6Brackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }
  return host;
}

/**
 * Classify an arbitrary IP literal (with or without IPv6 brackets).
 * Returns null if the input is not a valid IP literal — caller should treat
 * non-IP hostnames as "needs DNS resolution" rather than allow/deny.
 */
export function classifyIp(input: string): IpInfo | null {
  const stripped = stripIpv6Brackets(input.trim());
  if (!stripped) return null;
  const fam = isIP(stripped);
  if (fam === 0) return null;

  if (fam === 4 || isIPv4(stripped)) {
    const c = classifyIpv4(stripped);
    return {
      address: stripped,
      family: 'ipv4',
      classification: c,
      isPrivateOrSpecial: c !== 'public',
      isMetadata: c === 'metadata',
      isIpv4Mapped: false,
    };
  }

  if (fam === 6 || isIPv6(stripped)) {
    const v4 = extractIpv4Mapped(stripped);
    if (v4) {
      const c = classifyIpv4(v4);
      return {
        address: v4,
        family: 'ipv4',
        classification: c,
        // IPv4-mapped IPv6 in egress is almost always a smuggling attempt
        // against a v4-only blocklist. Never let it slip through.
        isPrivateOrSpecial: true,
        isMetadata: c === 'metadata',
        isIpv4Mapped: true,
      };
    }
    const c = classifyIpv6Raw(stripped);
    return {
      address: stripped,
      family: 'ipv6',
      classification: c,
      isPrivateOrSpecial: c !== 'public',
      isMetadata: c === 'metadata',
      isIpv4Mapped: false,
    };
  }

  return null;
}

/**
 * True if the given IP literal is unsafe for default-deny egress, i.e.
 * private / link-local / metadata / loopback / multicast / reserved.
 */
export function isPrivateOrSpecialIp(input: string): boolean {
  const info = classifyIp(input);
  return !!info && info.isPrivateOrSpecial;
}

/** True if the given IP literal is a known cloud metadata endpoint. */
export function isMetadataIp(input: string): boolean {
  const info = classifyIp(input);
  return !!info && info.isMetadata;
}
