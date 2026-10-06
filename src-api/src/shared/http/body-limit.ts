import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { getSetting } from '@/shared/db/operations';

const MB = 1024 * 1024;

/** Settings key synced from the frontend (see BACKEND_SYNCED_KEYS). */
export const ATTACHMENT_UPLOAD_LIMIT_SETTING = 'attachmentUploadLimitMb';
export const DEFAULT_ATTACHMENT_UPLOAD_LIMIT_MB = 1024;
export const MIN_ATTACHMENT_UPLOAD_LIMIT_MB = 1;
/** Matches the 4 GB cap of the copy-from-path branch of /files/attachment-save. */
export const MAX_ATTACHMENT_UPLOAD_LIMIT_MB = 4096;

/** Route that streams chat attachments to disk; capped by the user setting. */
export const ATTACHMENT_UPLOAD_PATH = '/files/attachment-save';

// 100MB for agent routes (base64-encoded image attachments inflate ~33%, so
// 6 × 2.4MB raw ≈ 19MB wire), 10MB for everything else.
const AGENT_BODY_LIMIT = 100 * MB;
const VIDEO_BODY_LIMIT = 500 * MB;
const DEFAULT_BODY_LIMIT = 10 * MB;

/** User-configured attachment upload cap in bytes, clamped to a sane range. */
export function getAttachmentUploadLimitBytes(): number {
  const raw = getSetting(ATTACHMENT_UPLOAD_LIMIT_SETTING);
  const parsed = raw
    ? Number.parseInt(raw, 10)
    : DEFAULT_ATTACHMENT_UPLOAD_LIMIT_MB;
  const mb = Number.isFinite(parsed)
    ? Math.min(
        MAX_ATTACHMENT_UPLOAD_LIMIT_MB,
        Math.max(MIN_ATTACHMENT_UPLOAD_LIMIT_MB, parsed),
      )
    : DEFAULT_ATTACHMENT_UPLOAD_LIMIT_MB;
  return mb * MB;
}

/**
 * Hono buffers bodies without Content-Length. Raw attachment uploads instead
 * enforce their received-byte limit while streaming to disk in the handler.
 * JSON copy metadata keeps the normal small request cap.
 */
export const requestBodyLimit: MiddlewareHandler = async (c, next) => {
  const rawUpload =
    c.req.method === 'POST' &&
    c.req.path === ATTACHMENT_UPLOAD_PATH &&
    !c.req.header('content-type')?.includes('application/json');
  const limit = rawUpload
    ? getAttachmentUploadLimitBytes()
    : c.req.path === ATTACHMENT_UPLOAD_PATH
      ? DEFAULT_BODY_LIMIT
      : resolveRequestBodyLimit(c.req.path);
  if (rawUpload) {
    const length = c.req.header('content-length');
    if (length && Number(length) > limit) {
      return c.json({ error: 'File too large', limitBytes: limit }, 413);
    }
    return next();
  }
  return bodyLimit({
    maxSize: limit,
    onError: (ctx) =>
      ctx.json({ error: 'Payload Too Large', limitBytes: limit }, 413),
  })(c, next);
};

/** Request body cap for each route family. */
export function resolveRequestBodyLimit(requestPath: string): number {
  if (requestPath === ATTACHMENT_UPLOAD_PATH) {
    return getAttachmentUploadLimitBytes();
  }
  if (requestPath.startsWith('/agent')) return AGENT_BODY_LIMIT;
  if (requestPath.startsWith('/video')) return VIDEO_BODY_LIMIT;
  return DEFAULT_BODY_LIMIT;
}
