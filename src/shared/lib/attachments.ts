/**
 * Attachment storage utilities
 *
 * Stores attachment files in the session folder instead of database
 * to avoid bloating the database with large binary data.
 *
 * Structure: ~/.<slug>/sessions/{sessionId}/attachments/{filename}
 */

import { API_BASE_URL } from '@/config';
import type {
  AttachmentSourceContext,
  MessageAttachment,
} from '@/shared/hooks/useAgent';
import { isTauriRuntime } from '@/shared/utils/tauri';
import { randomUUID } from '@/shared/utils/uuid';

const isTauri = isTauriRuntime;

/**
 * Generate a unique filename for an attachment
 */
function generateAttachmentFilename(
  originalName: string,
  mimeType?: string,
): string {
  const uniqueId = randomUUID().replace(/-/g, '').slice(0, 14);

  // Get extension from original name or mime type
  let ext = '';
  if (originalName.includes('.')) {
    ext = originalName.split('.').pop() || '';
  } else if (mimeType) {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf',
    };
    ext = mimeToExt[mimeType] || 'bin';
  }

  return `${uniqueId}${ext ? '.' + ext : ''}`;
}

/**
 * Convert base64 data URL to Uint8Array
 */
function base64ToUint8Array(base64Data: string): Uint8Array {
  // Remove data URL prefix if present
  const base64 = base64Data.includes(',')
    ? base64Data.split(',')[1]
    : base64Data;

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string efficiently using chunked processing
 * to avoid blocking the main thread for large files
 */
async function uint8ArrayToBase64Async(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
): Promise<string> {
  // For small files (< 100KB), use direct conversion
  if (bytes.length < 100 * 1024) {
    // Use Blob + FileReader for efficient conversion
    const blob = new Blob([bytes], { type: mimeType });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // For larger files, process in chunks with yielding to main thread
  const CHUNK_SIZE = 64 * 1024; // 64KB chunks
  const chunks: string[] = [];

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE);
    // Convert chunk to binary string
    let binary = '';
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    chunks.push(binary);

    // Yield to main thread every chunk to prevent blocking
    if (i + CHUNK_SIZE < bytes.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const base64 = btoa(chunks.join(''));
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Save a base64-encoded attachment to the session folder via Tauri's fs.
 *
 * Returns the absolute path on success, **null** on failure. The old
 * behaviour of returning `attachment.data` (the base64 blob itself) on
 * failure was actively harmful: callers stored it as `ref.path`, which then
 * leaked into the `[ATTACHED FILES …]` prompt prefix as an entire data URI,
 * ballooning context size and hanging the agent. Callers must handle a null
 * return — typically by re-trying via the backend endpoint.
 */
export async function saveAttachmentToFile(
  sessionFolder: string,
  attachment: MessageAttachment,
): Promise<string | null> {
  if (!isTauri() || !attachment.data) return null;

  try {
    const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');

    const attachmentsDir = `${sessionFolder}/attachments`;
    try {
      await mkdir(attachmentsDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    const filename = generateAttachmentFilename(
      attachment.name,
      attachment.mimeType,
    );
    const filePath = `${attachmentsDir}/${filename}`;

    const bytes = base64ToUint8Array(attachment.data);
    await writeFile(filePath, bytes);

    if (import.meta.env.DEV)
      console.warn('[Attachments] Saved attachment to:', filePath);
    return filePath;
  } catch (error) {
    if (import.meta.env.DEV)
      console.error('[Attachments] Failed to save attachment:', error);
    return null;
  }
}

/**
 * Load attachment from file system
 * Takes a file path and returns base64 data URL
 */
export async function loadAttachmentFromFile(
  filePath: string,
  mimeType?: string,
): Promise<string> {
  // If it's already a data URL, return as-is
  if (filePath.startsWith('data:')) {
    return filePath;
  }

  if (!isTauri()) {
    // In browser mode, can't read from file system
    return filePath;
  }

  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');

    const bytes = await readFile(filePath);
    const mime = mimeType || guessMimeType(filePath);
    const dataUrl = await uint8ArrayToBase64Async(bytes, mime);

    return dataUrl;
  } catch (error) {
    console.error('[Attachments] Failed to load attachment:', error);
    return filePath;
  }
}

/**
 * Guess MIME type from file extension
 */
function guessMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const extToMime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    json: 'application/json',
  };
  return extToMime[ext || ''] || 'application/octet-stream';
}

/**
 * Attachment reference stored in database
 * Contains path instead of actual data
 */
export interface AttachmentReference {
  id: string;
  type: 'image' | 'file';
  name: string;
  path: string; // File path instead of data
  mimeType?: string;
  sourceContext?: AttachmentSourceContext;
}

/**
 * Convert MessageAttachment to AttachmentReference (for database storage)
 */
export async function attachmentToReference(
  sessionFolder: string,
  attachment: MessageAttachment,
): Promise<AttachmentReference | null> {
  const filePath = await saveAttachmentToFile(sessionFolder, attachment);
  if (!filePath) return null;

  return {
    id: attachment.id,
    type: attachment.type,
    name: attachment.name,
    path: filePath,
    mimeType: attachment.mimeType,
    sourceContext: attachment.sourceContext,
  };
}

/**
 * Convert AttachmentReference back to MessageAttachment (for display)
 */
export async function referenceToAttachment(
  ref: AttachmentReference,
): Promise<MessageAttachment> {
  const data = await loadAttachmentFromFile(ref.path, ref.mimeType);

  return {
    id: ref.id,
    type: ref.type,
    name: ref.name,
    data,
    mimeType: ref.mimeType,
    path: ref.path, // Preserve path for conversation history
    sourceContext: ref.sourceContext,
  };
}

/**
 * Save a File object directly to the session folder without base64 encoding.
 * Uses File.arrayBuffer() for streaming binary I/O — avoids the 33% memory
 * inflation of base64 and prevents the UI from freezing on large files.
 *
 * Returns the absolute path of the saved file.
 */
export async function saveFileObjectToFolder(
  sessionFolder: string,
  file: File,
  mimeType?: string,
): Promise<string> {
  if (!isTauri()) {
    throw new Error('saveFileObjectToFolder requires Tauri environment');
  }

  const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');

  const attachmentsDir = `${sessionFolder}/attachments`;
  try {
    await mkdir(attachmentsDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  const filename = generateAttachmentFilename(file.name, mimeType);
  const filePath = `${attachmentsDir}/${filename}`;

  // Stream binary from File → Uint8Array → disk (no base64 intermediate)
  const buffer = await file.arrayBuffer();
  await writeFile(filePath, new Uint8Array(buffer));

  if (import.meta.env.DEV)
    console.warn(
      '[Attachments] Saved file object to:',
      filePath,
      `(${file.size} bytes)`,
    );
  return filePath;
}

/**
 * Save multiple attachments and return references
 */
export async function saveAttachments(
  sessionFolder: string,
  attachments: MessageAttachment[],
): Promise<AttachmentReference[]> {
  const references: AttachmentReference[] = [];

  for (const attachment of attachments) {
    const ref = await attachmentToReference(sessionFolder, attachment);
    if (ref) references.push(ref);
  }

  return references;
}

/** True when `filePath` is inside `dir` (or equals it). */
function isInsideDir(filePath: string, dir: string): boolean {
  const normalDir = dir.endsWith('/') ? dir : dir + '/';
  return filePath === dir || filePath.startsWith(normalDir);
}

/**
 * Persist an attachment via the backend's `/files/attachment-save` endpoint.
 *
 * Used whenever the user's workDir lives outside Tauri's static fs scope
 * (e.g. an external drive like `/Volumes/4TB_WD/…`). The backend has
 * unrestricted filesystem access and writes directly to
 * `${workDir}/sessions/session-${taskId}/attachments/`.
 *
 * Accepts either an in-memory `File` (multipart upload) or an existing
 * absolute `sourcePath` (server-side copy). Returns the resolved disk path
 * of the saved attachment, or null on failure.
 */
/**
 * Maximum time we'll wait on `/files/attachment-save` before giving up and
 * falling back to the Tauri fs path. Chosen to cover a 100 MB upload on a
 * slow disk but still bound the user-visible stall if the API server hangs —
 * the user's submit should never be blocked indefinitely by attachment
 * bookkeeping.
 */
const BACKEND_ATTACHMENT_TIMEOUT_MS = 60_000;

async function persistAttachmentViaBackend(
  args: {
    taskId: string;
    workDir?: string;
    name?: string;
  } & ({ file: File } | { sourcePath: string }),
): Promise<string | null> {
  const signal = AbortSignal.timeout(BACKEND_ATTACHMENT_TIMEOUT_MS);
  try {
    let res: Response;
    if ('file' in args) {
      const form = new FormData();
      form.append('taskId', args.taskId);
      if (args.workDir) form.append('workDir', args.workDir);
      form.append('file', args.file, args.name ?? args.file.name);
      res = await fetch(`${API_BASE_URL}/files/attachment-save`, {
        method: 'POST',
        body: form,
        signal,
      });
    } else {
      res = await fetch(`${API_BASE_URL}/files/attachment-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: args.taskId,
          workDir: args.workDir,
          sourcePath: args.sourcePath,
          name: args.name,
        }),
        signal,
      });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Surface in production — a 413 here is exactly how large video drops
      // silently lose their [ATTACHED FILES …] prefix (the resolver falls
      // through to a path-less attachment, buildAgentPrompt drops it, and
      // the agent only sees the bare user text).
      console.error(
        '[Attachments] Backend attachment-save failed:',
        res.status,
        body,
      );
      return null;
    }
    const data = (await res.json()) as { path?: string };
    return data.path ?? null;
  } catch (err) {
    console.error('[Attachments] Backend attachment-save threw:', err);
    return null;
  }
}

/**
 * Turn user-supplied MessageAttachments into on-disk AttachmentReferences.
 *
 * Three strategies, cheapest first:
 *   1. **Existing path** (`a.path` set, no `a.data`) — drag-drop from Finder.
 *      If the path is already inside the session folder or the user's
 *      workDir, reuse it; otherwise copy it into `sessionFolder/attachments/`
 *      so sandboxed agents (Codex workspace-write) can read it.
 *   2. **File object** (`a.file` with no path/data) — file picker / paste.
 *      Stream the binary to `sessionFolder/attachments/` via
 *      `saveFileObjectToFolder`.
 *   3. **Base64 data** (`a.data` non-empty) — browser fallback.
 *      Decode and save via `saveAttachments`.
 *
 * Silently skips attachments that match none of the strategies so a single
 * malformed entry can't lose the whole submission. Callers should check
 * refs.length against attachments.length if they need strictness.
 */
/**
 * Optional IDs that let `resolveFileAttachments` route writes through the
 * backend. Required when the session folder lives outside Tauri's fs scope
 * (e.g. an external drive); ignored otherwise.
 */
export interface ResolveAttachmentsContext {
  taskId?: string;
  workDir?: string;
}

export async function resolveFileAttachments(
  attachments: MessageAttachment[],
  sessionFolder: string,
  workDir?: string,
  ctx?: ResolveAttachmentsContext,
): Promise<AttachmentReference[]> {
  const taskId = ctx?.taskId;
  const effectiveWorkDir = ctx?.workDir ?? workDir;

  const resolveOne = async (
    a: MessageAttachment,
  ): Promise<AttachmentReference | null> => {
    if (a.path && !a.data) {
      const alreadyAccessible =
        isInsideDir(a.path, sessionFolder) ||
        (workDir != null && isInsideDir(a.path, workDir));
      if (alreadyAccessible) {
        return {
          id: a.id,
          type: a.type,
          name: a.name,
          path: a.path,
          mimeType: a.mimeType,
          sourceContext: a.sourceContext,
        };
      }

      // Prefer the backend — its fs access isn't bound by Tauri's scope
      // allowlist, so it works when the session folder lives outside $HOME.
      let destPath: string | null = null;
      if (taskId) {
        destPath = await persistAttachmentViaBackend({
          taskId,
          workDir: effectiveWorkDir,
          sourcePath: a.path,
          name: a.name,
        });
      }
      if (!destPath) {
        destPath = await copyPathViaTauri(sessionFolder, a);
      }
      if (!destPath && import.meta.env.DEV) {
        // Both backend upload and Tauri copy failed. The agent will receive
        // the original path in the prompt — if that path is outside the
        // workspace (e.g. ~/Downloads), sandboxed agents won't be able to
        // read it. Surface the fallback so the dev can see why.
        console.warn(
          '[Attachments] Unable to stage attachment; surfacing original path to agent:',
          a.path,
        );
      }
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        path: destPath ?? a.path,
        mimeType: a.mimeType,
        sourceContext: a.sourceContext,
      };
    }

    if (!a.data && a.file) {
      let savedPath: string | null = null;
      if (taskId) {
        savedPath = await persistAttachmentViaBackend({
          taskId,
          workDir: effectiveWorkDir,
          file: a.file,
          name: a.name,
        });
      }
      if (!savedPath) {
        try {
          savedPath = await saveFileObjectToFolder(
            sessionFolder,
            a.file,
            a.mimeType,
          );
        } catch (err) {
          if (import.meta.env.DEV)
            console.error('[Attachments] Failed to save file object:', err);
          savedPath = null;
        }
      }
      return savedPath
        ? {
            id: a.id,
            type: a.type,
            name: a.name,
            path: savedPath,
            mimeType: a.mimeType,
            sourceContext: a.sourceContext,
          }
        : null;
    }

    if (a.data && a.data.length > 0) {
      // Prefer the backend so paste/base64 attachments work on external
      // drives outside Tauri's fs scope. Fall back to the Tauri path only
      // if the backend is unavailable.
      let savedPath: string | null = null;
      if (taskId) {
        savedPath = await persistAttachmentViaBackend({
          taskId,
          workDir: effectiveWorkDir,
          file: base64ToFile(a.data, a.name, a.mimeType),
          name: a.name,
        });
      }
      if (!savedPath) savedPath = await saveAttachmentToFile(sessionFolder, a);
      return savedPath
        ? {
            id: a.id,
            type: a.type,
            name: a.name,
            path: savedPath,
            mimeType: a.mimeType,
            sourceContext: a.sourceContext,
          }
        : null;
    }

    return null;
  };

  const settled = await Promise.all(attachments.map(resolveOne));
  return settled.filter((r): r is AttachmentReference => r !== null);
}

/**
 * Copy an existing on-disk file into the session's attachments folder via
 * the Tauri plugin-fs. Last-resort fallback — only reached when the backend
 * endpoint isn't reachable. Returns null on any failure so the caller can
 * fall through to surfacing the original path.
 */
async function copyPathViaTauri(
  sessionFolder: string,
  a: MessageAttachment,
): Promise<string | null> {
  try {
    const { copyFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const attachmentsDir = `${sessionFolder}/attachments`;
    try {
      await mkdir(attachmentsDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
    const uniquePrefix = randomUUID().replace(/-/g, '').slice(0, 8);
    const safeName = a.name.replace(/[/\\]/g, '_');
    const destPath = `${attachmentsDir}/${uniquePrefix}_${safeName}`;
    await copyFile(a.path!, destPath);
    return destPath;
  } catch (err) {
    if (import.meta.env.DEV)
      console.error(
        '[Attachments] Failed to copy file to session folder:',
        err,
      );
    return null;
  }
}

function base64ToFile(
  dataUri: string,
  name: string | undefined,
  mimeType: string | undefined,
): File {
  const mime = mimeType ?? 'application/octet-stream';
  const bytes = base64ToUint8Array(dataUri);
  // Back the File with a plain ArrayBuffer so TS doesn't complain about
  // SharedArrayBuffer-backed views being passed as BlobParts.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new File([buf], name || 'attachment', { type: mime });
}

/**
 * Load multiple attachments from references
 * Uses controlled concurrency to avoid overwhelming the system
 */
export async function loadAttachments(
  references: AttachmentReference[],
  concurrencyLimit: number = 3,
): Promise<MessageAttachment[]> {
  if (references.length === 0) return [];

  // For small number of attachments, load in parallel
  if (references.length <= concurrencyLimit) {
    return Promise.all(references.map((ref) => referenceToAttachment(ref)));
  }

  // For larger numbers, use controlled concurrency
  const results: MessageAttachment[] = new Array(references.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < references.length) {
      const index = currentIndex++;
      results[index] = await referenceToAttachment(references[index]);
    }
  }

  // Start workers
  const workers = Array(concurrencyLimit)
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);

  return results;
}
