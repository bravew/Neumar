/**
 * Normalize URL hostnames before every SSRF classifier or egress-rule match.
 *
 * Absolute-FQDN forms such as `localhost.`, `169.254.169.254.`, and
 * `metadata.google.internal.` resolve identically to their dotless forms, but
 * Node's URL parser preserves the trailing dot for DNS names. Strip it before
 * string equality checks so blocklists cannot be bypassed with FQDN spelling.
 */
export function normalizeHost(hostname: string): string {
  const stripped =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  return stripped.toLowerCase().replace(/\.+$/, '');
}
