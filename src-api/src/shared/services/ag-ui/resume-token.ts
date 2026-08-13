// Token format: `<base64url(payload)>.<base64url(hmac(payload))>`
// where payload = JSON.stringify({ runId, approvalId, exp }).
// Tying the token to runId+approvalId prevents cross-run replay; the
// expiry blocks late approvals after the user has walked away.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { getSetting, setSetting } from '@/shared/db/operations';

const SECRET_KEY = 'aguiSigningSecret';
const HMAC_ALGORITHM = 'sha256';

/** Default 15-minute TTL — long enough for review, short enough to limit exposure. */
export const DEFAULT_RESUME_TOKEN_TTL_MS = 15 * 60 * 1000;

interface TokenPayload {
  runId: string;
  approvalId: string;
  /** Unix epoch millis. */
  exp: number;
}

let cachedSecret: string | null = null;

function getOrCreateSecret(): string {
  if (cachedSecret) return cachedSecret;
  const existing = getSetting(SECRET_KEY);
  if (existing && existing.length >= 32) {
    cachedSecret = existing;
    return existing;
  }
  const generated = randomBytes(32).toString('hex');
  setSetting(SECRET_KEY, generated);
  cachedSecret = generated;
  return generated;
}

function sign(payloadBytes: Buffer, secret: string): Buffer {
  return createHmac(HMAC_ALGORITHM, secret).update(payloadBytes).digest();
}

export interface SignResumeTokenInput {
  runId: string;
  approvalId: string;
  ttlMs?: number;
}

export interface SignedResumeToken {
  token: string;
  /** Keyed HMAC-SHA256 of the full token (hex) — safe to persist for revocation/equality checks. */
  hash: string;
  expiresAt: string;
}

export function signResumeToken(
  input: SignResumeTokenInput,
): SignedResumeToken {
  const ttl = input.ttlMs ?? DEFAULT_RESUME_TOKEN_TTL_MS;
  const exp = Date.now() + ttl;
  const payload: TokenPayload = {
    runId: input.runId,
    approvalId: input.approvalId,
    exp,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const secret = getOrCreateSecret();
  const sig = sign(payloadBytes, secret);
  const token = `${payloadBytes.toString('base64url')}.${sig.toString('base64url')}`;
  const hash = createHmac('sha256', secret).update(token).digest('hex');
  return {
    token,
    hash,
    expiresAt: new Date(exp).toISOString(),
  };
}

export type VerifyResumeTokenResult =
  | { ok: true; runId: string; approvalId: string; exp: number }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

export function verifyResumeToken(token: string): VerifyResumeTokenResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  let payloadBytes: Buffer;
  let signatureBytes: Buffer;
  try {
    payloadBytes = Buffer.from(parts[0]!, 'base64url');
    signatureBytes = Buffer.from(parts[1]!, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const secret = getOrCreateSecret();
  const expected = sign(payloadBytes, secret);
  if (
    expected.length !== signatureBytes.length ||
    !timingSafeEqual(expected, signatureBytes)
  ) {
    return { ok: false, reason: 'signature' };
  }

  let payload: TokenPayload;
  try {
    const parsed = JSON.parse(payloadBytes.toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as TokenPayload).runId !== 'string' ||
      typeof (parsed as TokenPayload).approvalId !== 'string' ||
      typeof (parsed as TokenPayload).exp !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }
    payload = parsed as TokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    runId: payload.runId,
    approvalId: payload.approvalId,
    exp: payload.exp,
  };
}

/** Test/admin hook — rotates the signing secret. All outstanding tokens become invalid. */
export function rotateResumeTokenSecret(): void {
  const generated = randomBytes(32).toString('hex');
  setSetting(SECRET_KEY, generated);
  cachedSecret = generated;
}
