/**
 * Plugin signature verification (alpha).
 *
 * Plugins may include `metadata.neuma.signature = { algorithm: 'ed25519',
 * publicKeyId, signature }` in their manifest. The signature is computed over
 * the canonical JSON of the manifest with the `metadata.neuma.signature`
 * field stripped — i.e. signing only commits to manifest contents, not to
 * payload bytes (tarball verification ships in a follow-up).
 *
 * Trusted publisher keys live in {@link ./trusted-keys.json}. Unknown keys
 * yield a verdict of `null` (badge: "Unsigned"); a present-but-bad signature
 * yields `false` (badge: "Invalid signature — proceed with caution"); a
 * matching key + valid signature yields `true` (badge: "Signed").
 */

import { createPublicKey, verify as cryptoVerify } from 'crypto';

import { createLogger } from '@/shared/utils/logger';

import type { PluginManifest } from './manifest';
// Static JSON import so esbuild inlines the trusted-keys map into the bundle.
// Reading via fs.readFile breaks in the packaged Tauri sidecar (the file would
// need an explicit `pkg.assets` entry); inlining sidesteps that entirely.
import trustedKeysData from './trusted-keys.json' with { type: 'json' };

const logger = createLogger('PluginVerify');

interface TrustedKeysFile {
  keys: Record<string, string>;
}

const bundledTrustedKeys: TrustedKeysFile = (() => {
  const data = trustedKeysData as { keys?: unknown };
  if (
    !data ||
    typeof data !== 'object' ||
    !data.keys ||
    typeof data.keys !== 'object'
  ) {
    logger.warn(
      'Bundled trusted-keys.json is malformed; treating all signatures as unknown',
    );
    return { keys: {} };
  }
  return { keys: data.keys as Record<string, string> };
})();

let trustedKeysOverride: TrustedKeysFile | null = null;

function loadTrustedKeys(): TrustedKeysFile {
  return trustedKeysOverride ?? bundledTrustedKeys;
}

/**
 * Canonical-JSON of the manifest with `metadata.neuma.signature` stripped.
 * Sorted-keys + tight separators so signers and verifiers agree byte-for-byte.
 */
export function canonicalizeManifest(manifest: PluginManifest): string {
  const clone = structuredClone(manifest) as PluginManifest & {
    metadata?: { neuma?: { signature?: unknown } };
  };
  if (clone.metadata?.neuma?.signature !== undefined) {
    delete clone.metadata.neuma.signature;
  }
  return stableStringify(clone);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map(stableStringify).join(',') + ']';
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}

export type VerifyVerdict =
  /** Signed by a trusted key, signature valid. */
  | { kind: 'signed'; publicKeyId: string }
  /** No signature on the manifest — badge as "Unsigned". */
  | { kind: 'unsigned' }
  /** Signature present but key is unknown — badge as "Unsigned (unknown publisher)". */
  | { kind: 'unknown-key'; publicKeyId: string }
  /** Signature present, key known, but the bytes don't verify — badge as "Invalid". */
  | { kind: 'invalid'; publicKeyId: string; reason: string };

export interface VerifyResult {
  verdict: VerifyVerdict;
  signatureOk: boolean | null;
}

/**
 * Verify a manifest's embedded signature. Never throws — every failure mode
 * collapses to a {@link VerifyVerdict} so the caller can decide whether to
 * block, warn, or just badge.
 */
export async function verifyManifestSignature(
  manifest: PluginManifest,
): Promise<VerifyResult> {
  const sig = manifest.metadata?.neuma?.signature;
  if (!sig) {
    return { verdict: { kind: 'unsigned' }, signatureOk: null };
  }

  const trusted = loadTrustedKeys();
  const pem = trusted.keys[sig.publicKeyId];
  if (!pem) {
    return {
      verdict: { kind: 'unknown-key', publicKeyId: sig.publicKeyId },
      signatureOk: null,
    };
  }

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({ key: pem, format: 'pem' });
  } catch (err) {
    return {
      verdict: {
        kind: 'invalid',
        publicKeyId: sig.publicKeyId,
        reason: `cannot load trusted key: ${(err as Error).message}`,
      },
      signatureOk: false,
    };
  }

  // Node's base64 decoder is lenient (drops invalid chars silently), so the
  // catch-and-report pattern is dead code. Validate explicitly so a corrupt
  // signature surfaces a useful reason instead of a generic mismatch.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(sig.signature)) {
    return {
      verdict: {
        kind: 'invalid',
        publicKeyId: sig.publicKeyId,
        reason: 'signature is not valid base64',
      },
      signatureOk: false,
    };
  }
  const signatureBytes = Buffer.from(sig.signature, 'base64');
  const payload = Buffer.from(canonicalizeManifest(manifest), 'utf-8');
  const ok = cryptoVerify(null, payload, publicKey, signatureBytes);
  if (!ok) {
    return {
      verdict: {
        kind: 'invalid',
        publicKeyId: sig.publicKeyId,
        reason: 'signature does not match manifest',
      },
      signatureOk: false,
    };
  }

  return {
    verdict: { kind: 'signed', publicKeyId: sig.publicKeyId },
    signatureOk: true,
  };
}

export function _resetTrustedKeysCache(): void {
  trustedKeysOverride = null;
}

export function _setTrustedKeysForTest(keys: Record<string, string>): void {
  trustedKeysOverride = { keys };
}
