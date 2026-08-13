import { generateKeyPairSync } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginManifest } from '@/shared/plugins/manifest';
import {
  _resetTrustedKeysCache,
  _setTrustedKeysForTest,
  verifyManifestSignature,
} from '@/shared/plugins/verify';

import { signManifestForTest } from '../../fixtures/sign';

const baseManifest: PluginManifest = {
  name: 'demo',
  version: '1.0.0',
  description: 'A demo plugin',
  skills: 'skills',
};

function makeKeyPair() {
  return generateKeyPairSync('ed25519');
}

function pemEncode(
  publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'],
): string {
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function pemEncodePrivate(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
): string {
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

describe('verifyManifestSignature', () => {
  beforeEach(() => {
    _resetTrustedKeysCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetTrustedKeysCache();
  });

  it('returns "unsigned" verdict when no signature is present', async () => {
    const result = await verifyManifestSignature(baseManifest);
    expect(result.verdict.kind).toBe('unsigned');
    expect(result.signatureOk).toBeNull();
  });

  it('returns "unknown-key" when the signing key is not trusted', async () => {
    _setTrustedKeysForTest({});
    const manifest: PluginManifest = {
      ...baseManifest,
      metadata: {
        neuma: {
          signature: {
            algorithm: 'ed25519',
            publicKeyId: 'unknown-key-id',
            signature: 'AAAA',
          },
        },
      },
    };
    const result = await verifyManifestSignature(manifest);
    expect(result.verdict.kind).toBe('unknown-key');
    expect(result.signatureOk).toBeNull();
  });

  it('round-trips: a manifest signed with a trusted key verifies as "signed"', async () => {
    const { publicKey, privateKey } = makeKeyPair();
    const publicPem = pemEncode(publicKey);
    const privatePem = pemEncodePrivate(privateKey);
    const keyId = 'test-key-1';

    _setTrustedKeysForTest({ [keyId]: publicPem });

    const unsigned: PluginManifest = {
      ...baseManifest,
      metadata: {
        neuma: {
          signature: {
            algorithm: 'ed25519',
            publicKeyId: keyId,
            signature: 'placeholder',
          },
        },
      },
    };
    const signature = signManifestForTest(unsigned, privatePem);
    const signed: PluginManifest = {
      ...unsigned,
      metadata: {
        neuma: {
          signature: {
            algorithm: 'ed25519',
            publicKeyId: keyId,
            signature,
          },
        },
      },
    };

    const result = await verifyManifestSignature(signed);
    expect(result.verdict.kind).toBe('signed');
    expect(result.signatureOk).toBe(true);
  });

  it('returns "invalid" when bytes have been tampered after signing', async () => {
    const { publicKey, privateKey } = makeKeyPair();
    const publicPem = pemEncode(publicKey);
    const privatePem = pemEncodePrivate(privateKey);
    const keyId = 'test-key-2';

    _setTrustedKeysForTest({ [keyId]: publicPem });

    const placeholder: PluginManifest = {
      ...baseManifest,
      metadata: {
        neuma: {
          signature: {
            algorithm: 'ed25519',
            publicKeyId: keyId,
            signature: 'placeholder',
          },
        },
      },
    };
    const signature = signManifestForTest(placeholder, privatePem);
    const tampered: PluginManifest = {
      ...placeholder,
      description: 'I was tampered with after signing',
      metadata: {
        neuma: {
          signature: {
            algorithm: 'ed25519',
            publicKeyId: keyId,
            signature,
          },
        },
      },
    };

    const result = await verifyManifestSignature(tampered);
    expect(result.verdict.kind).toBe('invalid');
    expect(result.signatureOk).toBe(false);
  });
});
