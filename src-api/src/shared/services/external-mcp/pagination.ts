import { ExternalMcpError } from '@/shared/mcp/public-server/errors';
import { MAX_PAYLOAD_BYTES } from '@/shared/mcp/public-server/schemas';

export interface CursorKey {
  updatedAt: string;
  id: string;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  truncated: boolean;
  byteLength: number;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(`${key.updatedAt}|${key.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): CursorKey {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator <= 0 || separator === decoded.length - 1) {
      throw new Error('invalid cursor');
    }
    return {
      updatedAt: decoded.slice(0, separator),
      id: decoded.slice(separator + 1),
    };
  } catch {
    throw new ExternalMcpError(
      'VALIDATION_FAILED',
      'Invalid pagination cursor',
    );
  }
}

function compareDesc(left: CursorKey, right: CursorKey): number {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt < right.updatedAt ? 1 : -1;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

export function byteLengthOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function paginateItems<T>(
  items: T[],
  options: {
    cursor?: string;
    limit: number;
    getKey: (item: T) => CursorKey;
  },
): PageResult<T> {
  const sorted = [...items].sort((left, right) =>
    compareDesc(options.getKey(left), options.getKey(right)),
  );
  let start = 0;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    start = sorted.findIndex(
      (item) => compareDesc(options.getKey(item), decoded) < 0,
    );
    if (start < 0) start = sorted.length;
  }

  const window = sorted.slice(start, start + options.limit);
  let page = window;
  let truncated = start + options.limit < sorted.length;
  let payload = {
    items: page,
    nextCursor: null as string | null,
    truncated,
    byteLength: 0,
  };
  payload.byteLength = byteLengthOf(payload);
  while (page.length > 1 && payload.byteLength > MAX_PAYLOAD_BYTES) {
    page = page.slice(0, -1);
    truncated = true;
    payload = {
      items: page,
      nextCursor: null,
      truncated,
      byteLength: 0,
    };
    payload.byteLength = byteLengthOf(payload);
  }

  const last = page.at(-1);
  const consumed = start + page.length;
  const hasMore = consumed < sorted.length;
  const nextCursor =
    last && (hasMore || truncated) ? encodeCursor(options.getKey(last)) : null;
  const result = {
    items: page,
    nextCursor,
    truncated: truncated || hasMore,
    byteLength: 0,
  };
  result.byteLength = byteLengthOf(result);
  if (result.byteLength > MAX_PAYLOAD_BYTES && page.length === 1) {
    throw new ExternalMcpError(
      'PAYLOAD_TOO_LARGE',
      'A single result exceeds the payload cap',
    );
  }
  return result;
}

export function capObject<T extends object>(
  value: T,
): {
  value: T;
  truncated: boolean;
  byteLength: number;
} {
  const byteLength = byteLengthOf(value);
  if (byteLength > MAX_PAYLOAD_BYTES) {
    throw new ExternalMcpError(
      'PAYLOAD_TOO_LARGE',
      'Result exceeds the payload cap',
    );
  }
  return { value, truncated: false, byteLength };
}
