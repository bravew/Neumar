const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.google',
  '169.254.169.254',
  '169.254.170.2',
  '168.63.129.16',
]);

const LAN_IPV4_PATTERNS = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/,
];

const BLOCKED_IPV4_PATTERNS = [/^0\.0\.0\.0$/, /^169\.254\.\d+\.\d+$/];

const BLOCKED_IPV6_PATTERNS = [
  /^::$/,
  /^::ffff:/i,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i,
];

export interface PersonalMediaUrlPolicyResult {
  valid: boolean;
  reason?: string;
  lanReachable?: boolean;
}

export function validatePersonalMediaBaseUrl(
  value: string,
  options: { allowLan?: boolean } = {},
): PersonalMediaUrlPolicyResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, reason: 'unsupported_protocol' };
  }
  if (url.username || url.password) {
    return { valid: false, reason: 'credentials_not_allowed' };
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (METADATA_HOSTS.has(host)) {
    return { valid: false, reason: 'metadata_host_blocked' };
  }
  if (BLOCKED_IPV4_PATTERNS.some((pattern) => pattern.test(host))) {
    return { valid: false, reason: 'blocked_internal_ip' };
  }
  if (BLOCKED_IPV6_PATTERNS.some((pattern) => pattern.test(host))) {
    return { valid: false, reason: 'blocked_internal_ip' };
  }

  const lanReachable = isLanHost(host);
  if (lanReachable) {
    if (!options.allowLan) {
      return { valid: false, reason: 'lan_url_requires_explicit_opt_in' };
    }
    return { valid: true, lanReachable: true };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, reason: 'https_required' };
  }
  return { valid: true, lanReachable: false };
}

function isLanHost(host: string): boolean {
  return (
    host === 'localhost' ||
    /^127\.\d+\.\d+\.\d+$/.test(host) ||
    host === '::1' ||
    LAN_IPV4_PATTERNS.some((pattern) => pattern.test(host)) ||
    host.endsWith('.local') ||
    host.endsWith('.ts.net')
  );
}
