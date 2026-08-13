/**
 * Encrypted Secrets Store
 *
 * AES-256-GCM encrypted store for user-defined secrets (API keys, tokens, etc.).
 *
 * Design:
 * - Secrets are NEVER stored in plaintext. They live in `~/.neumar/secrets.enc.json`,
 *   encrypted with a key derived from `PBKDF2(hostname + username + nonce, salt, 100k, sha512)`.
 * - After `initSecretVault()` the decrypted values are held in an in-memory Map so
 *   callers can read them synchronously (no I/O on the hot path).
 * - Name metadata (but never values) is stored in the `secure_secrets` SQLite table.
 *
 * Platform compatibility:
 * - Unix: file is chmod 600 (owner read/write only).
 * - Windows: chmod is skipped; the user-profile directory is protected by NTFS ACLs.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { dirname } from 'path';

import { getSecretsPath } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Secrets');

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha512';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EncryptedField {
  iv: string;
  data: string;
  tag: string;
}

interface DiskSecretStore {
  _salt?: string;
  _nonce?: string;
  secrets: Record<string, EncryptedField>;
}

// In-memory cache: name → decrypted value string
let secretCache: Map<string, string> | null = null;

// ── Encryption helpers ─────────────────────────────────────────────────────────

function encryptValue(value: string, key: Buffer): EncryptedField {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptValue(enc: EncryptedField, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(enc.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(enc.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function isEncryptedField(v: unknown): v is EncryptedField {
  return (
    typeof v === 'object' &&
    v !== null &&
    'iv' in v &&
    'data' in v &&
    'tag' in v
  );
}

async function deriveKey(salt: Buffer, nonce: string): Promise<Buffer> {
  const seed = `${os.hostname()}${os.userInfo().username}${nonce}`;
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      seed,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_LENGTH,
      PBKDF2_DIGEST,
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

async function getEncryptionKey(
  disk: DiskSecretStore,
): Promise<{ key: Buffer; salt: string; nonce: string }> {
  let salt: Buffer;
  let nonce: string;

  if (disk._salt && disk._nonce) {
    salt = Buffer.from(disk._salt, 'base64');
    nonce = disk._nonce;
  } else {
    salt = crypto.randomBytes(32);
    nonce = crypto.randomBytes(16).toString('base64');
  }

  const key = await deriveKey(salt, nonce);
  return { key, salt: salt.toString('base64'), nonce };
}

// ── Disk I/O ───────────────────────────────────────────────────────────────────

async function readDiskStore(): Promise<DiskSecretStore> {
  try {
    const content = await fs.readFile(getSecretsPath(), 'utf-8');
    return JSON.parse(content) as DiskSecretStore;
  } catch {
    return { secrets: {} };
  }
}

async function writeDiskStore(disk: DiskSecretStore): Promise<void> {
  const path = getSecretsPath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(disk, null, 2), 'utf-8');
  // Restrict to owner read/write on Unix; Windows uses NTFS ACLs on the profile dir.
  if (os.platform() !== 'win32') {
    await fs.chmod(path, 0o600);
  }
}

// ── SQLite helpers (lazy import to avoid circular deps) ────────────────────────

async function upsertSecretMeta(name: string, hint: string): Promise<void> {
  const { getDatabase } = await import('@/shared/db');
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO secure_secrets (id, name, hint, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET hint = excluded.hint, updated_at = datetime('now')
  `).run(id, name, hint);
}

async function deleteSecretMeta(name: string): Promise<void> {
  const { getDatabase } = await import('@/shared/db');
  const db = getDatabase();
  db.prepare('DELETE FROM secure_secrets WHERE name = ?').run(name);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Load all secrets from disk into memory.
 * Must be called once at startup before any `getSecret()` calls.
 */
export async function initSecretVault(): Promise<void> {
  secretCache = new Map();

  const disk = await readDiskStore();

  if (disk._salt) {
    const { key } = await getEncryptionKey(disk);
    for (const [name, enc] of Object.entries(disk.secrets ?? {})) {
      if (isEncryptedField(enc)) {
        try {
          secretCache.set(name, decryptValue(enc, key));
        } catch (err) {
          logger.warn(`Failed to decrypt secret '${name}'`, err);
        }
      }
    }
    logger.info(`Secret vault loaded (${secretCache.size} secret(s))`);
  } else {
    logger.info('Secret vault initialized (empty)');
  }
}

/**
 * Encrypt and persist a secret. Also records the name in `secure_secrets`.
 * Never logs the plaintext value or ciphertext.
 */
export async function storeSecret(name: string, value: string): Promise<void> {
  const disk = await readDiskStore();
  const { key, salt, nonce } = await getEncryptionKey(disk);

  disk._salt = salt;
  disk._nonce = nonce;
  if (!disk.secrets) disk.secrets = {};
  disk.secrets[name] = encryptValue(value, key);

  await writeDiskStore(disk);

  if (!secretCache) secretCache = new Map();
  secretCache.set(name, value);

  const hint = value.slice(-4);
  await upsertSecretMeta(name, hint);
  logger.info(`Stored secret '${name}'`);
}

/**
 * Return the decrypted value for a secret from the in-memory cache.
 * Synchronous — safe to call from sync contexts after `initSecretVault()`.
 * Returns `null` if the vault was not initialised or the secret does not exist.
 */
export function getSecret(name: string): string | null {
  return secretCache?.get(name) ?? null;
}

/**
 * Delete a secret from the vault file, SQLite, and the in-memory cache.
 */
export async function deleteSecret(name: string): Promise<void> {
  const disk = await readDiskStore();
  if (disk.secrets?.[name]) {
    delete disk.secrets[name];
    await writeDiskStore(disk);
  }
  secretCache?.delete(name);
  await deleteSecretMeta(name);
  logger.info(`Deleted secret '${name}'`);
}

/**
 * List all secrets from SQLite with last-4-char hints (authoritative — values never returned).
 */
export async function listSecretsWithHints(): Promise<
  { name: string; hint: string }[]
> {
  const { getDatabase } = await import('@/shared/db');
  const db = getDatabase();
  return db
    .prepare('SELECT name, hint FROM secure_secrets ORDER BY name')
    .all() as { name: string; hint: string }[];
}

/**
 * Stub: migrate known API key settings into the encrypted vault.
 * Reads each key name from settings and stores the value encrypted.
 * Does NOT remove the original settings entry — removal is a separate concern.
 */
export async function migrateApiKeysFromSettings(
  keys: string[],
): Promise<void> {
  const { getSetting } = await import('@/shared/db/operations');
  let migrated = 0;
  for (const key of keys) {
    const value = getSetting(key as Parameters<typeof getSetting>[0]);
    if (value) {
      await storeSecret(key, value);
      migrated++;
    }
  }
  logger.info(
    `migrateApiKeysFromSettings: migrated ${migrated}/${keys.length} key(s)`,
  );
}
