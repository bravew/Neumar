import { describe, expect, it } from 'vitest';

import { containsSensitiveContent } from '@/shared/services/memory/store';

describe('containsSensitiveContent', () => {
  // ── Should detect ──

  it('detects OpenAI API keys', () => {
    expect(
      containsSensitiveContent('My key is sk-abcdefghijklmnopqrstuvwxyz1234'),
    ).toBe(true);
  });

  it('detects GitHub personal access tokens', () => {
    expect(
      containsSensitiveContent(
        'Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234',
      ),
    ).toBe(true);
  });

  it('detects Bearer tokens', () => {
    expect(
      containsSensitiveContent(
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      ),
    ).toBe(true);
  });

  it('detects password assignments', () => {
    expect(containsSensitiveContent('password: hunter2')).toBe(true);
    expect(containsSensitiveContent('PASSWORD=s3cr3t')).toBe(true);
  });

  it('detects secret assignments', () => {
    expect(containsSensitiveContent('secret: mySecretValue123')).toBe(true);
    expect(containsSensitiveContent('SECRET=topSecret')).toBe(true);
  });

  // ── Should NOT detect ──

  it('allows normal preference text', () => {
    expect(containsSensitiveContent('I prefer dark mode for all editors')).toBe(
      false,
    );
  });

  it('allows a decision about architecture', () => {
    expect(
      containsSensitiveContent('We decided to use Redis for session storage'),
    ).toBe(false);
  });

  it('allows short words containing "secret" as substring', () => {
    // "secretary" should not match — but "secret:" will
    expect(containsSensitiveContent('The secretary sent notes')).toBe(false);
  });

  it('allows mention of password policy without assignment', () => {
    expect(
      containsSensitiveContent('We require passwords to be at least 12 chars'),
    ).toBe(false);
  });
});
