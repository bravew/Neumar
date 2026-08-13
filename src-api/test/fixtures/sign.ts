/**
 * Test-only ed25519 signer for plugin manifests. Lives in the test tree so
 * `cryptoSign` never enters the production import graph of `verify.ts`.
 */

import { sign as cryptoSign } from 'crypto';

import type { PluginManifest } from '@/shared/plugins';
import { canonicalizeManifest } from '@/shared/plugins/verify';

export function signManifestForTest(
  manifest: PluginManifest,
  privateKeyPem: string,
): string {
  const payload = Buffer.from(canonicalizeManifest(manifest), 'utf-8');
  return cryptoSign(null, payload, {
    key: privateKeyPem,
    format: 'pem',
  }).toString('base64');
}
