/**
 * Credential Vault
 *
 * AES-256-GCM encrypted store for channel bot credentials
 * (Telegram botToken, Discord token, Slack botToken/appToken, Lark appId/appSecret).
 *
 * Design:
 * - Real tokens are NEVER stored in plaintext in SQLite. The `channel_config.token`
 *   column holds only the sentinel string `'__vault__'`.
 * - Credentials live in `~/.neumar/channel-creds.enc.json`, encrypted with a key
 *   derived from `PBKDF2(hostname + username + nonce, salt, 100k, sha512)`.
 * - After `initCredentialVault()` the decrypted tokens are held in an in-memory
 *   Map so callers can read them synchronously (no I/O on the hot path).
 *
 * Platform compatibility:
 * - Unix: file is chmod 600 (owner read/write only).
 * - Windows: chmod is skipped; the user-profile directory is protected by NTFS ACLs.
 *
 * Migration:
 * - On first boot after this change, any existing plaintext tokens found in SQLite
 *   are automatically encrypted into the vault and replaced with the sentinel.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { dirname } from 'path';

import { getChannelCredsPath } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CredentialVault');

// Sentinel stored in SQLite in place of the real token.
export const VAULT_SENTINEL = '__vault__';

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha512';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EncryptedField {
  iv: string;
  data: string;
  tag: string;
}

interface DiskCredStore {
  _salt?: string;
  _nonce?: string;
  credentials: Record<string, EncryptedField>;
}

// In-memory cache: configId (or legacy platform) → decrypted token string
let credCache: Map<string, string> | null = null;

// ── Encryption helpers (identical pattern to token-manager.ts) ────────────────

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
  disk: DiskCredStore,
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

// ── Disk I/O ──────────────────────────────────────────────────────────────────

async function readDiskStore(): Promise<DiskCredStore> {
  try {
    const content = await fs.readFile(getChannelCredsPath(), 'utf-8');
    return JSON.parse(content) as DiskCredStore;
  } catch {
    return { credentials: {} };
  }
}

async function writeDiskStore(disk: DiskCredStore): Promise<void> {
  const path = getChannelCredsPath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(disk, null, 2), 'utf-8');
  // Restrict to owner read/write on Unix; Windows uses NTFS ACLs on the profile dir.
  if (os.platform() !== 'win32') {
    await fs.chmod(path, 0o600);
  }
}

// ── Migration ─────────────────────────────────────────────────────────────────

/**
 * One-time migration: encrypt any plaintext tokens found in `channel_config`
 * and replace them with the vault sentinel. Safe to call repeatedly — rows
 * already holding the sentinel are skipped.
 */
async function migrateFromSqlite(): Promise<void> {
  // Lazy import avoids a circular-dependency cycle (db/operations imports nothing from auth/).
  const { getDatabase } = await import('@/shared/db');
  const db = getDatabase();

  type Row = { id: string; platform: string; token: string | null };
  const rows = db
    .prepare(
      'SELECT id, platform, token FROM channel_config WHERE token IS NOT NULL AND token != ?',
    )
    .all(VAULT_SENTINEL) as Row[];

  if (rows.length === 0) return;

  logger.info(`Migrating ${rows.length} plaintext channel token(s) to vault`);

  for (const row of rows) {
    try {
      // Store under configId (the row's UUID), not platform string
      await writeToVault(row.id, row.token!);
      db.prepare('UPDATE channel_config SET token = ? WHERE id = ?').run(
        VAULT_SENTINEL,
        row.id,
      );
      logger.info(
        `Migrated ${row.platform}:${row.id.slice(0, 8)} credential to vault`,
      );
    } catch (err) {
      logger.error(`Failed to migrate ${row.platform} credential`, err);
    }
  }
}

/**
 * Re-key legacy vault entries from platform string keys to configId UUIDs.
 * Called once during initCredentialVault after loading from disk.
 */
async function rekeyLegacyPlatformKeys(): Promise<void> {
  if (!credCache) return;
  const platformNames = new Set(['telegram', 'discord', 'slack', 'lark']);
  const legacyKeys = [...credCache.keys()].filter((k) => platformNames.has(k));
  if (legacyKeys.length === 0) return;

  const { getChannelConfigsByPlatform } =
    await import('@/shared/db/operations');

  const disk = await readDiskStore();
  let changed = false;

  for (const platformKey of legacyKeys) {
    const configs = getChannelConfigsByPlatform(
      platformKey as 'telegram' | 'discord' | 'slack' | 'lark',
    );
    if (configs.length === 1) {
      const configId = configs[0]!.id;
      const token = credCache.get(platformKey)!;
      credCache.set(configId, token);
      credCache.delete(platformKey);
      if (disk.credentials[platformKey]) {
        disk.credentials[configId] = disk.credentials[platformKey]!;
        delete disk.credentials[platformKey];
        changed = true;
      }
      logger.info(
        `Re-keyed vault entry: ${platformKey} → ${configId.slice(0, 8)}`,
      );
    } else {
      logger.warn(
        `Cannot re-key ${platformKey}: found ${configs.length} configs (expected 1)`,
      );
    }
  }

  if (changed) {
    await writeDiskStore(disk);
  }
}

// ── Internal write ────────────────────────────────────────────────────────────

/** Encrypt and persist a single credential. Also updates the in-memory cache. */
async function writeToVault(configId: string, token: string): Promise<void> {
  const disk = await readDiskStore();
  const { key, salt, nonce } = await getEncryptionKey(disk);

  disk._salt = salt;
  disk._nonce = nonce;
  if (!disk.credentials) disk.credentials = {};
  disk.credentials[configId] = encryptValue(token, key);

  await writeDiskStore(disk);

  if (!credCache) credCache = new Map();
  credCache.set(configId, token);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load all channel credentials from disk into memory.
 * Also migrates any leftover plaintext tokens from SQLite.
 * Must be called once at startup, before `ChannelManager.startAll()`.
 */
export async function initCredentialVault(): Promise<void> {
  credCache = new Map();

  const disk = await readDiskStore();

  if (disk._salt) {
    const { key } = await getEncryptionKey(disk);
    for (const [platform, enc] of Object.entries(disk.credentials ?? {})) {
      if (isEncryptedField(enc)) {
        try {
          credCache.set(platform, decryptValue(enc, key));
        } catch (err) {
          logger.warn(`Failed to decrypt credential for ${platform}`, err);
        }
      }
    }
    logger.info(`Credential vault loaded (${credCache.size} credential(s))`);
  } else {
    logger.info('Credential vault initialized (empty)');
  }

  // Re-key any legacy platform-string vault entries to configId UUIDs.
  await rekeyLegacyPlatformKeys();

  // Always run migration in case SQLite has leftover plaintext tokens from before this change.
  await migrateFromSqlite();
}

/**
 * Persist a channel credential to the vault.
 * Returns `VAULT_SENTINEL` — store this string in the SQLite `token` column.
 */
export async function saveChannelCredential(
  configId: string,
  token: string,
): Promise<typeof VAULT_SENTINEL> {
  await writeToVault(configId, token);
  logger.info(`Saved credential for ${configId.slice(0, 8)}`);
  return VAULT_SENTINEL;
}

/**
 * Return the decrypted token for a configId from the in-memory cache.
 * Synchronous — safe to call from sync contexts after `initCredentialVault()`.
 * Returns `null` if the vault was not initialised or the configId has no credential.
 */
export function getChannelToken(configId: string): string | null {
  return credCache?.get(configId) ?? null;
}

/** Returns `true` if a credential exists for the given configId. */
export function hasChannelCredential(configId: string): boolean {
  return !!credCache?.get(configId);
}

/**
 * Delete a credential from both the vault file and the in-memory cache.
 * Callers should also clear or reset the SQLite `token` column.
 */
export async function removeChannelCredential(configId: string): Promise<void> {
  const disk = await readDiskStore();
  if (disk.credentials?.[configId]) {
    delete disk.credentials[configId];
    await writeDiskStore(disk);
  }
  credCache?.delete(configId);
  logger.info(`Removed credential for ${configId.slice(0, 8)}`);
}

/**
 * Merge incoming token fields with the existing vault entry, save the result,
 * and return `VAULT_SENTINEL`.
 *
 * Handles two token formats:
 * - Plain string (Telegram / Discord): if `incoming` starts with `'...'` it is a
 *   masked placeholder — leave the vault entry unchanged.
 * - JSON object (Slack / Lark): each sub-field is merged independently; masked
 *   sub-fields (`'...'` prefix) fall back to the corresponding vault value.
 *
 * Returns `undefined` when there is nothing to save (no incoming token and no
 * existing credential).
 */
/**
 * Merge masked sub-fields in a JSON token string with existing vault values.
 * Fields starting with '...' are replaced by the corresponding vault value.
 * Pure function — no I/O, no side effects.
 */
export function mergeTokenFields(
  incoming: string,
  existingRaw: string | null,
): string {
  const inObj = JSON.parse(incoming) as Record<string, unknown>;
  const exObj: Record<string, string> = existingRaw
    ? (JSON.parse(existingRaw) as Record<string, string>)
    : {};
  const merged = Object.fromEntries(
    Object.entries(inObj).map(([k, v]) => {
      const val = typeof v === 'string' ? v : '';
      return [k, val && !val.startsWith('...') ? val : (exObj[k] ?? val)];
    }),
  );
  return JSON.stringify(merged);
}

export async function mergeAndSaveCredential(
  configId: string,
  incoming: string | undefined,
): Promise<typeof VAULT_SENTINEL | undefined> {
  if (!incoming) {
    // No token in the request — leave vault unchanged if credential already exists.
    return hasChannelCredential(configId) ? VAULT_SENTINEL : undefined;
  }

  // JSON token (Slack: {botToken, appToken}; Lark: {appId, appSecret})
  try {
    const existingRaw = getChannelToken(configId);
    const mergedStr = mergeTokenFields(incoming, existingRaw);

    // Only write if something actually changed.
    if (existingRaw !== mergedStr) {
      await saveChannelCredential(configId, mergedStr);
    }
    return VAULT_SENTINEL;
  } catch {
    // Plain string token.
    if (incoming.startsWith('...') || incoming === VAULT_SENTINEL) {
      // Masked / sentinel passthrough — keep existing vault entry.
      return hasChannelCredential(configId) ? VAULT_SENTINEL : undefined;
    }
    await saveChannelCredential(configId, incoming);
    return VAULT_SENTINEL;
  }
}
