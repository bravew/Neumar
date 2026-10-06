/**
 * Attach-by-path helpers.
 *
 * A browser never exposes the path of a picked or dropped `File`, so a large
 * local file can only be uploaded. The API runs on the same machine as the
 * page, though, so a path the user supplies can be read in place instead.
 */

import { API_BASE_URL } from '@/config';
import { isTauriRuntime } from '@/shared/utils/tauri';

/** Fired by the over-limit toast; the composer opens its path dialog. */
export const ATTACH_BY_PATH_EVENT = 'neumar:attach-by-path';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Longest line we treat as a path; anything longer is prose or data. */
const MAX_PATH_LENGTH = 4096;
const MAX_PASTED_PATHS = 20;

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
// Two segments at least, so slash commands such as `/help` stay text.
const POSIX_PATH = /^(?:~|\/[^/\0]+)\/[^\0]+/;

/**
 * True when the API shares a machine with the user, so a typed path means
 * the same file to both. A page served from another host does not qualify.
 */
export function canAttachLocalPaths(): boolean {
  if (isTauriRuntime()) return true;
  if (typeof window === 'undefined') return false;
  return LOOPBACK_HOSTS.has(window.location.hostname);
}

/** Ask the focused composer to open its "Attach by path" dialog. */
export function requestAttachByPath(): void {
  window.dispatchEvent(new CustomEvent(ATTACH_BY_PATH_EVENT));
}

function fileUriToPath(uri: string): string | null {
  try {
    const decoded = decodeURIComponent(new URL(uri).pathname);
    // `file:///C:/x` yields `/C:/x`.
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return null;
  }
}

/**
 * Normalise one user-typed path: strips matching quotes, converts `file://`
 * URIs, and unescapes the `\ ` Finder and shells put before spaces.
 * Returns null when the text is not an absolute or home-relative path.
 */
export function normalizePathInput(input: string): string | null {
  let text = input.trim();
  if (!text || text.length > MAX_PATH_LENGTH || /[\t\0]/.test(text))
    return null;
  const quote = text[0];
  if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith('file://')) {
    const fromUri = fileUriToPath(text);
    if (!fromUri) return null;
    text = fromUri;
  } else if (!WINDOWS_DRIVE_PATH.test(text)) {
    text = text.replace(/\\(.)/g, '$1');
  }
  return WINDOWS_DRIVE_PATH.test(text) || POSIX_PATH.test(text) ? text : null;
}

/**
 * Parse pasted text that consists only of file paths, one per line.
 * Returns null when any line is something else, so ordinary prose is never
 * mistaken for an attachment.
 */
export function parsePastedPaths(text: string): string[] | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.length > MAX_PASTED_PATHS) return null;
  const paths: string[] = [];
  for (const line of lines) {
    const normalized = normalizePathInput(line);
    if (!normalized) return null;
    paths.push(normalized);
  }
  return paths;
}

export type LocalFileCheck =
  | { ok: true; path: string; size: number }
  | { ok: false; reason: 'not_found' | 'not_file' | 'denied' | 'unreachable' };

interface StatResponse {
  exists?: boolean;
  denied?: boolean;
  resolvedPath?: string;
  isFile?: boolean;
  size?: number;
}

/** Ask the API whether `rawPath` is a regular file it may read. */
export async function checkLocalFile(rawPath: string): Promise<LocalFileCheck> {
  let body: StatResponse;
  try {
    const res = await fetch(`${API_BASE_URL}/files/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rawPath }),
    });
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    body = (await res.json()) as StatResponse;
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (body.denied) return { ok: false, reason: 'denied' };
  if (!body.exists) return { ok: false, reason: 'not_found' };
  if (!body.isFile) return { ok: false, reason: 'not_file' };
  return {
    ok: true,
    path: body.resolvedPath ?? rawPath,
    size: body.size ?? 0,
  };
}
