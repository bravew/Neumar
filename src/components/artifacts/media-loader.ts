/**
 * API-based file access utilities for media previews.
 *
 * Uses the backend `/files/stat` and `/files/read-binary` endpoints
 * instead of Tauri's `plugin-fs` to avoid security-scope "forbidden path" errors.
 *
 * When a file isn't found at the stored path (common with relative paths from
 * tool output), `resolveMediaPath` searches the session directory by filename.
 */

import { API_BASE_URL } from '@/config';

/** Simple LRU-ish cache for resolved paths (avoids repeated searches). */
const resolvedCache = new Map<string, string>();
const MAX_CACHE = 64;

/**
 * Resolve a media artifact path to a path that actually exists on disk.
 *
 * 1. Checks the given path via `/files/stat`.
 * 2. If not found, extracts the session root from the path and searches
 *    recursively via `/files/find-file`.
 * 3. Returns the found path, or the original if nothing was found.
 */
export async function resolveMediaPath(
  filePath: string,
  signal?: AbortSignal,
): Promise<string> {
  // Check cache first
  const cached = resolvedCache.get(filePath);
  if (cached) return cached;

  // Quick existence check
  const size = await getFileSize(filePath, signal);
  if (size !== null) {
    cache(filePath, filePath);
    return filePath;
  }

  // Extract session root: everything up to and including /sessions/<uuid>
  const sessionMatch = filePath.match(
    /^(.+\/sessions\/[0-9a-f-]+(?:_[^/]*)?)/i,
  );
  const searchDir = sessionMatch?.[1];
  if (!searchDir) return filePath; // can't determine where to search

  const basename = filePath.split('/').pop();
  if (!basename) return filePath;

  try {
    const res = await fetch(`${API_BASE_URL}/files/find-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: basename, searchDir }),
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as { found?: string | null };
      if (data.found) {
        cache(filePath, data.found);
        return data.found;
      }
    }
  } catch {
    // search failed — fall through
  }

  return filePath;
}

function cache(key: string, value: string) {
  if (resolvedCache.size >= MAX_CACHE) {
    // evict oldest
    const first = resolvedCache.keys().next().value;
    if (first !== undefined) resolvedCache.delete(first);
  }
  resolvedCache.set(key, value);
}

/**
 * Get file size via the backend API.
 * Returns `null` when the file doesn't exist or an error occurs.
 */
export async function getFileSize(
  filePath: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/files/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { exists?: boolean; size?: number };
    return data.exists ? (data.size ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Build a streaming URL for a local file.
 * The backend serves it directly with Range request support,
 * so the browser can stream video/audio without loading everything into memory.
 */
export function getStreamUrl(filePath: string, revision?: number): string {
  const params = new URLSearchParams({ path: filePath });
  if (revision !== undefined) params.set('v', String(revision));
  return `${API_BASE_URL}/files/stream?${params.toString()}`;
}

/**
 * Read a binary file via the backend API and return it as a Blob.
 *
 * The backend returns base64-encoded content which we decode client-side.
 * Falls back to Tauri `plugin-fs` if the API is unreachable (e.g. browser-only dev).
 */
/**
 * Max preview size — imported from utils to avoid circular deps at runtime.
 * Must match the value in `./utils.ts`.
 */
const LOCAL_MAX_PREVIEW = 50 * 1024 * 1024; // 50 MB

/**
 * Resolve, size-check, and read a local artifact file in one call.
 *
 * Handles path resolution (moved session dirs), size guard, and binary read.
 * Returns either `{ arrayBuffer }` on success or `{ tooLarge }` if the file
 * exceeds `maxSize`.  Throws on missing file or read error.
 */
export async function loadLocalArtifactBuffer(
  filePath: string,
  mimeType: string,
  maxSize: number = LOCAL_MAX_PREVIEW,
  signal?: AbortSignal,
): Promise<{ arrayBuffer: ArrayBuffer } | { tooLarge: number }> {
  const resolved = await resolveMediaPath(filePath, signal);
  const size = await getFileSize(resolved, signal);
  if (size !== null && size > maxSize) return { tooLarge: size };
  const blob = await readBinaryFile(resolved, mimeType, signal);
  return { arrayBuffer: await blob.arrayBuffer() };
}

export async function readBinaryFile(
  filePath: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<Blob> {
  try {
    const res = await fetch(`${API_BASE_URL}/files/read-binary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
      signal,
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      success: boolean;
      content: string;
      error?: string;
    };
    if (!data.success) {
      throw new Error(data.error || 'Failed to read file');
    }
    const binary = atob(data.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  } catch (err) {
    // Fallback: try Tauri plugin-fs for environments without the API server
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const data = await readFile(filePath);
      return new Blob([data], { type: mimeType });
    } catch {
      // Re-throw the original API error
      throw err;
    }
  }
}
