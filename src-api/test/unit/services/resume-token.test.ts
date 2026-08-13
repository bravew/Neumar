import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Per-file isolated HOME — avoids racing other DB-touching tests on the
// shared global-setup tmpdir (migration runner UNIQUE-constraint conflicts).
process.env.HOME = mkdtempSync(join(tmpdir(), 'neumar-rt-'));

import {
  rotateResumeTokenSecret,
  signResumeToken,
  verifyResumeToken,
} from '@/shared/services/ag-ui/resume-token';

describe('resume-token', () => {
  it('signs and verifies a fresh token', () => {
    const { token, hash, expiresAt } = signResumeToken({
      runId: 'run-1',
      approvalId: 'appr-1',
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const result = verifyResumeToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.runId).toBe('run-1');
      expect(result.approvalId).toBe('appr-1');
    }
  });

  it('rejects malformed tokens', () => {
    expect(verifyResumeToken('not-a-token')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyResumeToken('aaa.bbb.ccc')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects tampered payloads (signature check)', () => {
    const { token } = signResumeToken({
      runId: 'run-2',
      approvalId: 'appr-2',
    });
    // Flip the last character of the payload segment to invalidate the HMAC.
    const [payload, sig] = token.split('.');
    const tampered = `${payload!.slice(0, -1)}${payload!.endsWith('A') ? 'B' : 'A'}.${sig}`;
    const result = verifyResumeToken(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature|malformed/);
  });

  it('rejects expired tokens', () => {
    const { token } = signResumeToken({
      runId: 'run-3',
      approvalId: 'appr-3',
      ttlMs: -1, // already expired
    });
    expect(verifyResumeToken(token)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rotating the secret invalidates outstanding tokens', () => {
    const { token } = signResumeToken({
      runId: 'run-4',
      approvalId: 'appr-4',
    });
    expect(verifyResumeToken(token).ok).toBe(true);
    rotateResumeTokenSecret();
    const after = verifyResumeToken(token);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe('signature');
  });
});
