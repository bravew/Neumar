import { describe, expect, it } from 'vitest';

import { classifyYtDlpError } from '@/shared/video/source/ytdlp';

describe('classifyYtDlpError', () => {
  it('classifies HTTP 403 as non-retryable forbidden', () => {
    const r = classifyYtDlpError(
      'ERROR: unable to download video data: HTTP Error 403: Forbidden',
      1,
    );
    expect(r.category).toBe('forbidden');
    expect(r.retryable).toBe(false);
    expect(r.message).toMatch(/Do NOT retry/);
  });

  it('classifies bot/sign-in checks as forbidden', () => {
    const r = classifyYtDlpError(
      'ERROR: Sign in to confirm you’re not a bot',
      1,
    );
    expect(r.category).toBe('forbidden');
    expect(r.retryable).toBe(false);
  });

  it('classifies private/unavailable videos as non-retryable', () => {
    expect(classifyYtDlpError('ERROR: Private video', 1).retryable).toBe(false);
    expect(classifyYtDlpError('ERROR: Video unavailable', 1).category).toBe(
      'unavailable',
    );
  });

  it('classifies network errors as retryable', () => {
    const r = classifyYtDlpError('ERROR: Unable to connect: timed out', 1);
    expect(r.category).toBe('network');
    expect(r.retryable).toBe(true);
    expect(r.message).toMatch(/retry once/);
  });

  it('falls back to a non-retryable unknown classification', () => {
    const r = classifyYtDlpError('ERROR: something weird happened', 7);
    expect(r.category).toBe('unknown');
    expect(r.retryable).toBe(false);
    expect(r.message).toContain('exit code 7');
  });

  it('never echoes raw stderr (no secret leakage) for known categories', () => {
    const secretStderr =
      'ERROR: HTTP Error 403: Forbidden cookie=SECRET_TOKEN_abc123';
    const r = classifyYtDlpError(secretStderr, 1);
    expect(r.message).not.toContain('SECRET_TOKEN_abc123');
    expect(r.message).not.toContain('cookie=');
  });
});
