/**
 * Intersect a third-party MCP App CSP with the host sandbox policy.
 * The result is never wider than `hostCsp`: a source is kept only when the
 * host already allows that exact source on the same directive (or on
 * `default-src` when the host omits the directive).
 */

function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (!name) continue;
    directives.set(name, tokens.slice(1));
  }
  return directives;
}

function serializeCsp(directives: Map<string, string[]>): string {
  return [...directives.entries()]
    .map(([name, sources]) =>
      sources.length > 0 ? `${name} ${sources.join(' ')}` : name,
    )
    .join('; ');
}

export function intersectCsp(
  hostCsp: string,
  resourceCsp: string | undefined,
): string {
  if (!resourceCsp?.trim()) return hostCsp;
  const host = parseCsp(hostCsp);
  const resource = parseCsp(resourceCsp);
  const result = new Map(host);

  for (const [directive, sources] of resource) {
    const hostSources = host.get(directive) ?? host.get('default-src') ?? [];
    const allowed = new Set(hostSources);
    const tightened = sources.filter(
      (source) => source !== "'none'" && allowed.has(source),
    );
    if (tightened.length === 0) {
      result.set(directive, ["'none'"]);
    } else {
      result.set(directive, tightened);
    }
  }

  return serializeCsp(result);
}

/** Turn MCP Apps `ui.csp` (a string or a domain-list object) into a CSP string. */
export function resourceCspFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const ui = (meta as Record<string, unknown>).ui;
  if (!ui || typeof ui !== 'object') return undefined;
  const csp = (ui as Record<string, unknown>).csp;
  if (typeof csp === 'string') return csp;
  if (!csp || typeof csp !== 'object') return undefined;
  const record = csp as Record<string, unknown>;
  const parts: string[] = [];
  const domains = (key: string, directive: string) => {
    const value = record[key];
    if (!Array.isArray(value)) return;
    const sources = value.filter(
      (item): item is string => typeof item === 'string',
    );
    if (sources.length > 0) parts.push(`${directive} ${sources.join(' ')}`);
  };
  domains('connectDomains', 'connect-src');
  domains('resourceDomains', 'img-src');
  domains('frameDomains', 'frame-src');
  return parts.length > 0 ? parts.join('; ') : undefined;
}
