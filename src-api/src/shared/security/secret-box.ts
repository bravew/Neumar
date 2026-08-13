/**
 * Envelope encryption helpers.
 *
 * Two-tier model (per dev-doc/plan/2026-04-27-slack-app-home.md decision D2):
 *
 *   • KEK — derived once from `hostname + username + nonce` via PBKDF2; the
 *     salt + nonce are persisted in the `settings` table on first use so the
 *     same key re-derives across process restarts on the same machine.
 *   • DEK — random 32 bytes per logical owner (e.g. a Slack user). The DEK
 *     is wrapped with the KEK (AES-256-GCM) and stored alongside owner
 *     records. Per-record secrets are sealed with the unwrapped DEK.
 *
 * Disconnecting an owner deletes only the wrapped DEK, which crypto-shreds
 * every record encrypted under it without table scans.
 *
 * Existing legacy stores (`slack-config.ts`, `token-manager.ts`,
 * `credential-vault.ts`, `secrets.ts`) keep their per-file single-key
 * scheme — only new tables that need per-owner blast-radius isolation use
 * envelope encryption.
 */

import crypto from 'node:crypto';
import os from 'node:os';

import { getSetting, saveSetting } from '@/shared/db/operations';

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 32;
const NONCE_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;
const DEK_LENGTH_BYTES = 32;

const KEK_SALT_SETTING = 'secret_box_kek_salt';
const KEK_NONCE_SETTING = 'secret_box_kek_nonce';

/** Sealed payload — `iv`, `ct`, and `tag` are base64-encoded. */
export interface Sealed {
  iv: string;
  ct: string;
  tag: string;
}

let cachedKek: Buffer | null = null;

function deriveKey(seed: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    seed,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH_BYTES,
    PBKDF2_DIGEST,
  );
}

function loadOrCreateKekParams(): { salt: Buffer; nonce: string } {
  let saltB64 = getSetting(KEK_SALT_SETTING);
  let nonce = getSetting(KEK_NONCE_SETTING);
  if (!saltB64 || !nonce) {
    saltB64 = crypto.randomBytes(SALT_LENGTH_BYTES).toString('base64');
    nonce = crypto.randomBytes(NONCE_LENGTH_BYTES).toString('base64');
    saveSetting(KEK_SALT_SETTING, saltB64);
    saveSetting(KEK_NONCE_SETTING, nonce);
  }
  return { salt: Buffer.from(saltB64, 'base64'), nonce };
}

export function getKek(): Buffer {
  if (cachedKek) return cachedKek;
  const { salt, nonce } = loadOrCreateKekParams();
  // WARNING: KEK seed binds to host + OS user. If hostname rotates (e.g.
  // ephemeral container) or the OS user is renamed, the KEK can no longer
  // be re-derived and every wrapped DEK becomes permanently unreadable.
  // This is acceptable for the desktop/sidecar deployment target; revisit
  // if this ever runs in containerised environments.
  const seed = `${os.hostname()}${os.userInfo().username}${nonce}`;
  cachedKek = deriveKey(seed, salt);
  return cachedKek;
}

/** Test-only — drop the cached KEK so a freshly seeded settings table is honoured. */
export function _resetKekCacheForTests(): void {
  cachedKek = null;
}

export function generateDek(): Buffer {
  return crypto.randomBytes(DEK_LENGTH_BYTES);
}

function seal(key: Buffer, plaintext: Buffer | string): Sealed {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const buf =
    typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function open(key: Buffer, sealed: Sealed): Buffer {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(sealed.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final(),
  ]);
}

export function wrapDek(dek: Buffer, kek: Buffer = getKek()): Sealed {
  if (dek.length !== DEK_LENGTH_BYTES) {
    throw new Error(`DEK must be ${DEK_LENGTH_BYTES} bytes, got ${dek.length}`);
  }
  return seal(kek, dek);
}

export function unwrapDek(wrapped: Sealed, kek: Buffer = getKek()): Buffer {
  const dek = open(kek, wrapped);
  if (dek.length !== DEK_LENGTH_BYTES) {
    throw new Error('Unwrapped DEK has wrong length');
  }
  return dek;
}

export function encryptWith(dek: Buffer, plaintext: string): Sealed {
  return seal(dek, plaintext);
}

export function decryptWith(dek: Buffer, sealed: Sealed): string {
  return open(dek, sealed).toString('utf8');
}
