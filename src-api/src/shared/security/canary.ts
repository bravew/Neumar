/**
 * Per-session canary tokens.
 *
 * Canaries are placed in select environment variables fed to sandboxed children
 * so that any leak through tool args, request headers/body, model output, or
 * persisted artifacts is detectable without storing the raw secret elsewhere.
 *
 * Format: `NEUMA-CANARY-<sessionId8>-<random16>`
 *
 * Rules:
 *  - Audit logs MUST NEVER record the raw canary string. Only the suffix used
 *    for matching is acceptable, and even then in a redacted_snippet form.
 *  - Canaries must not be inserted into user files, fetched bodies, or
 *    third-party cookies — only into env vars/headers we control.
 */

import { randomBytes } from 'crypto';

const CANARY_PREFIX = 'NEUMA-CANARY-';
const RANDOM_BYTES = 12; // 12 bytes → 24 base32-ish hex chars; we trim to 16
const RANDOM_LEN = 16;

export interface CanaryToken {
  /** Full canary string. Treat as a secret — never log directly. */
  readonly value: string;
  /** Last 8 chars of the random portion, safe to surface in audit metadata. */
  readonly fingerprint: string;
}

function shortSuffix(input: string, length: number): string {
  // Not a hash — the fingerprint is a non-secret correlation handle. Using a
  // suffix keeps it cheap and obviously derivable from the canary.
  return input.slice(-length);
}

/**
 * Mint a canary token bound to a session id. Pure: callers may regenerate.
 */
export function generateCanary(sessionId: string): CanaryToken {
  const sessionPart =
    sessionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || '00000000';
  const random = randomBytes(RANDOM_BYTES).toString('hex').slice(0, RANDOM_LEN);
  const value = `${CANARY_PREFIX}${sessionPart}-${random}`;
  return { value, fingerprint: shortSuffix(random, 8) };
}

/**
 * Stream-safe scanner. Holds onto the tail of the previous chunk so a token
 * straddling a chunk boundary still matches. Returns true when a hit is
 * observed; the caller is responsible for halting the affected egress.
 *
 * Single-use per token: once detected the scanner stays "tripped" so a
 * follow-up call still reports the leak.
 */
export class CanaryScanner {
  private readonly token: string;
  private readonly tailWindow: number;
  private buffer = '';
  private tripped = false;

  constructor(token: string) {
    this.token = token;
    // Window must be at least token.length - 1 so a boundary-straddling match
    // is reconstructable across two chunks.
    this.tailWindow = token.length - 1;
  }

  /** Feed one chunk. Returns true if the canary appears anywhere observed. */
  scan(chunk: string | Uint8Array): boolean {
    if (this.tripped) return true;
    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const combined = this.buffer + text;
    if (combined.includes(this.token)) {
      this.tripped = true;
      this.buffer = '';
      return true;
    }
    // Keep just enough tail to catch a boundary-straddling token next chunk.
    this.buffer =
      combined.length > this.tailWindow
        ? combined.slice(combined.length - this.tailWindow)
        : combined;
    return false;
  }

  get hit(): boolean {
    return this.tripped;
  }

  reset(): void {
    this.tripped = false;
    this.buffer = '';
  }
}

/** One-shot helper for non-streaming inputs (full strings/buffers). */
export function containsCanary(
  token: string,
  input: string | Uint8Array,
): boolean {
  const text =
    typeof input === 'string' ? input : Buffer.from(input).toString('utf8');
  return text.includes(token);
}

export class CanaryLeakError extends Error {
  readonly fingerprint: string;
  readonly source: string;
  constructor(source: string, fingerprint: string) {
    super(`Canary detected in ${source} (fingerprint=${fingerprint})`);
    this.name = 'CanaryLeakError';
    this.fingerprint = fingerprint;
    this.source = source;
  }
}

/**
 * Walk an arbitrary tool-args object and throw CanaryLeakError if the canary
 * appears in any string value or key. Used by adapters to refuse to dispatch
 * a tool call that would smuggle the canary back to a sandboxed child.
 */
export function assertNoCanaryInToolArgs(
  token: string,
  fingerprint: string,
  source: string,
  args: unknown,
  depth = 0,
): void {
  if (depth > 12) return;
  if (typeof args === 'string') {
    if (args.includes(token)) throw new CanaryLeakError(source, fingerprint);
    return;
  }
  if (typeof args !== 'object' || args === null) return;
  if (Array.isArray(args)) {
    for (const item of args) {
      assertNoCanaryInToolArgs(token, fingerprint, source, item, depth + 1);
    }
    return;
  }
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (k.includes(token)) throw new CanaryLeakError(source, fingerprint);
    assertNoCanaryInToolArgs(token, fingerprint, source, v, depth + 1);
  }
}

/**
 * Stream wrapper: scans every chunk of an async iterable of strings for the
 * canary. On hit, throws CanaryLeakError so the consumer halts. Boundary-safe
 * via CanaryScanner. Use this around model output streams when a session has
 * an active canary.
 */
export async function* scanCanaryInStream(
  token: string,
  fingerprint: string,
  source: string,
  stream: AsyncIterable<string>,
): AsyncGenerator<string> {
  const scanner = new CanaryScanner(token);
  for await (const chunk of stream) {
    if (scanner.scan(chunk)) {
      throw new CanaryLeakError(source, fingerprint);
    }
    yield chunk;
  }
}
