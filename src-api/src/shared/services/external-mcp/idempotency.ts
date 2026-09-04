import { createHash } from 'node:crypto';

import { getDatabase } from '@/shared/db';
import { ExternalMcpError } from '@/shared/mcp/public-server/errors';

/** Sentinel stored while an async mutation is in flight. Not valid JSON. */
const PENDING_RESULT_JSON = '__pending__';

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

function readIdempotency(
  surface: string,
  requestId: string,
): IdempotencyRow | undefined {
  return getDatabase()
    .prepare(
      'SELECT surface, request_id, payload_digest, result_json FROM external_mcp_idempotency WHERE surface = ? AND request_id = ?',
    )
    .get(surface, requestId) as IdempotencyRow | undefined;
}

function replayOrConflict<T>(
  existing: IdempotencyRow,
  digest: string,
  requestId: string,
): T {
  if (existing.payload_digest !== digest) {
    throw new ExternalMcpError(
      'CONFLICT',
      'requestId was already used with a different payload',
      requestId,
    );
  }
  if (existing.result_json === PENDING_RESULT_JSON) {
    throw new ExternalMcpError(
      'CONFLICT',
      'requestId is already in progress',
      requestId,
    );
  }
  return JSON.parse(existing.result_json) as T;
}

function insertCompleted(
  surface: string,
  requestId: string,
  digest: string,
  result: unknown,
): void {
  getDatabase()
    .prepare(
      'INSERT INTO external_mcp_idempotency (surface, request_id, payload_digest, result_json) VALUES (?, ?, ?, ?)',
    )
    .run(surface, requestId, digest, JSON.stringify(result));
}

function reservePending(
  surface: string,
  requestId: string,
  digest: string,
): boolean {
  const inserted = getDatabase()
    .prepare(
      'INSERT OR IGNORE INTO external_mcp_idempotency (surface, request_id, payload_digest, result_json) VALUES (?, ?, ?, ?)',
    )
    .run(surface, requestId, digest, PENDING_RESULT_JSON);
  return inserted.changes === 1;
}

function completeReservation(
  surface: string,
  requestId: string,
  result: unknown,
): void {
  getDatabase()
    .prepare(
      'UPDATE external_mcp_idempotency SET result_json = ? WHERE surface = ? AND request_id = ?',
    )
    .run(JSON.stringify(result), surface, requestId);
}

function clearReservation(surface: string, requestId: string): void {
  getDatabase()
    .prepare(
      'DELETE FROM external_mcp_idempotency WHERE surface = ? AND request_id = ?',
    )
    .run(surface, requestId);
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
    const existing = readIdempotency(surface, requestId);
    if (existing) return replayOrConflict<T>(existing, digest, requestId);
    const result = run();
    insertCompleted(surface, requestId, digest, result);
    return result;
  })();
}

export async function withIdempotencyAsync<T>(
  surface: string,
  requestId: string,
  payload: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const digest = digestPayload(payload);
  if (!reservePending(surface, requestId, digest)) {
    const existing = readIdempotency(surface, requestId);
    if (!existing) {
      throw new ExternalMcpError(
        'CONFLICT',
        'requestId was already used with a different payload',
        requestId,
      );
    }
    return replayOrConflict<T>(existing, digest, requestId);
  }
  try {
    const result = await run();
    completeReservation(surface, requestId, result);
    return result;
  } catch (error) {
    clearReservation(surface, requestId);
    throw error;
  }
}
