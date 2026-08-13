const PROJECT_FILE_LINK_HASH_PREFIX = '#neuma-project-file=';

export function resolveInProjectLink(
  href: string | undefined,
  validPaths?: Iterable<string>,
): string | null {
  if (!href) return null;
  const withoutHash = href.split('#')[0] ?? '';
  const withoutQuery = withoutHash.split('?')[0] ?? '';
  const decoded = safeDecodeURIComponent(withoutQuery).replace(/\\/g, '/');
  if (
    !decoded ||
    decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  ) {
    return null;
  }
  const normalized = normalizeProjectPath(decoded);
  return resolveNormalizedProjectPath(normalized, validPaths);
}

export function encodeInProjectLinkHref(path: string): string {
  return `${PROJECT_FILE_LINK_HASH_PREFIX}${encodeURIComponent(path)}`;
}

export function decodeInProjectLinkHref(
  href: string | undefined,
  validPaths?: Iterable<string>,
): string | null {
  if (!href) return null;
  if (!href.startsWith(PROJECT_FILE_LINK_HASH_PREFIX)) return null;
  const encodedPath = href.slice(PROJECT_FILE_LINK_HASH_PREFIX.length);
  const decoded = safeDecodeURIComponent(encodedPath).replace(/\\/g, '/');
  return resolveNormalizedProjectPath(
    normalizeProjectPath(decoded),
    validPaths,
  );
}

function resolveNormalizedProjectPath(
  normalized: string,
  validPaths?: Iterable<string>,
): string | null {
  if (!normalized || normalized.startsWith('../')) return null;
  if (!looksLikeProjectFilePath(normalized)) return null;
  if (!validPaths) return normalized;
  const pathSet = new Set(validPaths);
  return pathSet.has(normalized) ? normalized : null;
}

function normalizeProjectPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return '../';
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function looksLikeProjectFilePath(path: string): boolean {
  const leaf = path.split('/').pop() ?? '';
  return leaf.includes('.') && !leaf.startsWith('.');
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
