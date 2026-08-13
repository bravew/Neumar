import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory shim for `getSetting` / `saveSetting`. The secret-box module
// reads + writes the KEK salt/nonce via these — tests don't need a real DB.
const settingsStore = new Map<string, string>();
vi.mock('@/shared/db/operations', () => ({
  getSetting: (key: string) => settingsStore.get(key) ?? null,
  saveSetting: (key: string, value: string) => {
    settingsStore.set(key, value);
  },
}));

import {
  _resetKekCacheForTests,
  decryptWith,
  encryptWith,
  generateDek,
  getKek,
  unwrapDek,
  wrapDek,
} from '@/shared/security/secret-box';

beforeEach(() => {
  settingsStore.clear();
  _resetKekCacheForTests();
});

afterEach(() => {
  _resetKekCacheForTests();
});

describe('secret-box envelope encryption', () => {
  it('wrapDek + unwrapDek round-trip', () => {
    const dek = generateDek();
    expect(dek.length).toBe(32);
    const wrapped = wrapDek(dek);
    expect(wrapped.iv).not.toEqual('');
    expect(wrapped.ct).not.toEqual('');
    expect(wrapped.tag).not.toEqual('');
    const unwrapped = unwrapDek(wrapped);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it('encryptWith + decryptWith round-trip plaintext', () => {
    const dek = generateDek();
    const sealed = encryptWith(dek, 'secret-token-xyz');
    expect(sealed.ct).not.toContain('secret-token-xyz');
    expect(decryptWith(dek, sealed)).toBe('secret-token-xyz');
  });

  it('rejects DEKs of the wrong length', () => {
    expect(() => wrapDek(Buffer.alloc(16))).toThrow();
  });

  it('uses the same KEK once salt/nonce are persisted', () => {
    const k1 = getKek();
    _resetKekCacheForTests();
    const k2 = getKek();
    expect(k1.equals(k2)).toBe(true);
  });

  it('deriving a fresh KEK after settings wipe yields a different key', () => {
    const k1 = getKek();
    settingsStore.clear();
    _resetKekCacheForTests();
    const k2 = getKek();
    expect(k1.equals(k2)).toBe(false);
  });

  it('ciphertext under DEK A cannot be decrypted with DEK B', () => {
    const a = generateDek();
    const b = generateDek();
    const sealed = encryptWith(a, 'top secret');
    expect(() => decryptWith(b, sealed)).toThrow();
  });

  it('tampered tag fails authenticated decrypt', () => {
    const dek = generateDek();
    const sealed = encryptWith(dek, 'token');
    const flippedTagBytes = Buffer.from(sealed.tag, 'base64');
    flippedTagBytes[0] = (flippedTagBytes[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptWith(dek, { ...sealed, tag: flippedTagBytes.toString('base64') }),
    ).toThrow();
  });
});
