import { describe, expect, it } from 'vitest';

import {
  assertNoCanaryInToolArgs,
  CanaryLeakError,
  CanaryScanner,
  containsCanary,
  generateCanary,
  scanCanaryInStream,
} from '@/shared/security/canary';

describe('canary tokens', () => {
  it('generates tokens with the expected prefix and embedded session marker', () => {
    const t = generateCanary('abcdef0123456789');
    expect(t.value.startsWith('NEUMA-CANARY-abcdef01-')).toBe(true);
    expect(t.fingerprint).toHaveLength(8);
  });

  it('handles short or non-alphanumeric session ids by padding', () => {
    const t = generateCanary('!!');
    expect(t.value.startsWith('NEUMA-CANARY-00000000-')).toBe(true);
  });

  it('returns distinct tokens on repeated calls (random portion)', () => {
    const a = generateCanary('session-x');
    const b = generateCanary('session-x');
    expect(a.value).not.toBe(b.value);
  });
});

describe('CanaryScanner', () => {
  it('detects a single-chunk hit', () => {
    const t = generateCanary('s1');
    const s = new CanaryScanner(t.value);
    expect(s.scan('hello')).toBe(false);
    expect(s.scan(`leaked: ${t.value} oops`)).toBe(true);
    expect(s.hit).toBe(true);
  });

  it('detects a token straddling two chunks', () => {
    const t = generateCanary('s2');
    const s = new CanaryScanner(t.value);
    const half = Math.floor(t.value.length / 2);
    const a = 'noise' + t.value.slice(0, half);
    const b = t.value.slice(half) + ' more noise';
    expect(s.scan(a)).toBe(false);
    expect(s.scan(b)).toBe(true);
  });

  it('detects a token straddling three chunks', () => {
    const t = generateCanary('s3');
    const s = new CanaryScanner(t.value);
    const a = t.value.slice(0, 5);
    const b = t.value.slice(5, 12);
    const c = t.value.slice(12);
    expect(s.scan(a)).toBe(false);
    expect(s.scan(b)).toBe(false);
    expect(s.scan(c)).toBe(true);
  });

  it('stays tripped once detected', () => {
    const t = generateCanary('s4');
    const s = new CanaryScanner(t.value);
    s.scan(t.value);
    expect(s.hit).toBe(true);
    expect(s.scan('benign')).toBe(true);
  });

  it('accepts Uint8Array chunks', () => {
    const t = generateCanary('s5');
    const s = new CanaryScanner(t.value);
    expect(s.scan(Buffer.from(t.value, 'utf8'))).toBe(true);
  });

  it('does not false-positive on a near-miss', () => {
    const t = generateCanary('s6');
    const s = new CanaryScanner(t.value);
    const tweaked = t.value.slice(0, -1) + (t.value.endsWith('a') ? 'b' : 'a');
    expect(s.scan(tweaked)).toBe(false);
  });
});

describe('containsCanary', () => {
  it('matches strings and buffers', () => {
    const t = generateCanary('s7');
    expect(containsCanary(t.value, `prefix ${t.value} suffix`)).toBe(true);
    expect(containsCanary(t.value, Buffer.from(t.value))).toBe(true);
    expect(containsCanary(t.value, 'no leak here')).toBe(false);
  });
});

describe('assertNoCanaryInToolArgs', () => {
  it('throws when canary is in a string value', () => {
    const t = generateCanary('s8');
    expect(() =>
      assertNoCanaryInToolArgs(t.value, t.fingerprint, 'tool:fetch', {
        url: `https://x/${t.value}`,
      }),
    ).toThrow(CanaryLeakError);
  });

  it('throws when canary is nested in an array', () => {
    const t = generateCanary('s9');
    expect(() =>
      assertNoCanaryInToolArgs(t.value, t.fingerprint, 'tool:exec', {
        argv: ['echo', t.value],
      }),
    ).toThrow(CanaryLeakError);
  });

  it('passes through benign args', () => {
    const t = generateCanary('s10');
    expect(() =>
      assertNoCanaryInToolArgs(t.value, t.fingerprint, 'tool:read_file', {
        path: '/etc/hostname',
      }),
    ).not.toThrow();
  });

  it('does not infinite-loop on cyclic args', () => {
    const t = generateCanary('s11');
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() =>
      assertNoCanaryInToolArgs(t.value, t.fingerprint, 'tool:cyclic', cyclic),
    ).not.toThrow();
  });
});

describe('scanCanaryInStream', () => {
  it('passes through benign chunks', async () => {
    const t = generateCanary('s12');
    async function* src() {
      yield 'hello ';
      yield 'world';
    }
    const out: string[] = [];
    for await (const c of scanCanaryInStream(
      t.value,
      t.fingerprint,
      'model',
      src(),
    )) {
      out.push(c);
    }
    expect(out.join('')).toBe('hello world');
  });

  it('throws on a leak across chunk boundaries', async () => {
    const t = generateCanary('s13');
    const half = Math.floor(t.value.length / 2);
    async function* src() {
      yield 'noise ' + t.value.slice(0, half);
      yield t.value.slice(half) + ' end';
    }
    await expect(async () => {
      for await (const _ of scanCanaryInStream(
        t.value,
        t.fingerprint,
        'model',
        src(),
      )) {
        // drain
      }
    }).rejects.toBeInstanceOf(CanaryLeakError);
  });
});
