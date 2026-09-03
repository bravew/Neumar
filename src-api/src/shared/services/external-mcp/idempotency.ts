import { createHash } from 'node:crypto';

import { getDatabase } from '@/shared/db';
import { ExternalMcpError } from '@/shared/mcp/public-server/errors';

interface IdempotencyRow {
  surface: string;
  request_id: string;
  payload_digest: string;
  result_json: string;
}

export function digestPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

export function withIdempotency<T>(
  surface: string,
  requestId: string,
  payload: unknown,
  run: () => T,
): T {
  const digest = digestPayload(payload);
  const db = getDatabase();
  return db.transaction(() => {
    const existing = db
      .prepare(
        'SELECT surface, request_id, payload_digest, result_json FROM external_mcp_idempotency WHERE surface = ? AND request_id = ?',
      )
      .get(surface, requestId) as IdempotencyRow | undefined;

    if (existing) {
      if (existing.payload_digest !== digest) {
        throw new ExternalMcpError(
          'CONFLICT',
          'requestId was already used with a different payload',
          requestId,
        );
      }
      return JSON.parse(existing.result_json) as T;
    }

    const result = run();
    db.prepare(
      'INSERT INTO external_mcp_idempotency (surface, request_id, payload_digest, result_json) VALUES (?, ?, ?, ?)',
    ).run(surface, requestId, digest, JSON.stringify(result));
    return result;
  })();
}
