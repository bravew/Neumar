/**
 * Token Manager
 *
 * Manages OAuth token lifecycle: encrypted storage, refresh, and revocation.
 * Tokens are stored in an AES-256-GCM encrypted JSON file on disk,
 * following the same pattern as linear-config.ts.
 *
 * The file is chmod 600 on Unix to prevent other users from reading it.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { dirname } from 'path';

import { getAuthTokensPath } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

import type { OAuthConnection, OAuthProvider, OAuthTokens } from './types';

const logger = createLogger('TokenManager');

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha512';

/** Buffer before expiry to trigger proactive refresh (5 minutes) */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

interface EncryptedField {
  iv: string;
  data: string;
  tag: string;
}

interface DiskTokenStore {
  _salt?: string;
  _nonce?: string;
  connections: Record<string, OAuthConnection>;
  tokens: Record<string, EncryptedField>;
}

// In-memory cache
let storeCache: {
  connections: Record<string, OAuthConnection>;
  tokens: Record<string, OAuthTokens>;
} | null = null;

// ============================================================================
// Encryption (same approach as linear-config.ts)
// ============================================================================

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

function decryptValue(encrypted: EncryptedField, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    typeof value === 'object' &&
    value !== null &&
    'iv' in value &&
    'data' in value &&
    'tag' in value
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
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}

async function getEncryptionKey(
  disk: DiskTokenStore,
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

// ============================================================================
// Disk I/O
// ============================================================================

async function readDiskStore(): Promise<DiskTokenStore> {
  const configPath = getAuthTokensPath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { connections: {}, tokens: {} };
  }
}

async function writeDiskStore(disk: DiskTokenStore): Promise<void> {
  const configPath = getAuthTokensPath();
  await fs.mkdir(dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(disk, null, 2), 'utf-8');

  if (os.platform() !== 'win32') {
    await fs.chmod(configPath, 0o600);
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Load all connections and their tokens from the encrypted store */
export async function loadTokenStore(): Promise<{
  connections: Record<string, OAuthConnection>;
  tokens: Record<string, OAuthTokens>;
}> {
  if (storeCache) return storeCache;

  const disk = await readDiskStore();

  if (!disk._salt) {
    // No store yet — return empty
    storeCache = { connections: {}, tokens: {} };
    return storeCache;
  }

  const { key } = await getEncryptionKey(disk);
  const tokens: Record<string, OAuthTokens> = {};

  for (const [provider, encrypted] of Object.entries(disk.tokens)) {
    if (isEncryptedField(encrypted)) {
      try {
        tokens[provider] = JSON.parse(decryptValue(encrypted, key));
      } catch (err) {
        logger.warn(`Failed to decrypt tokens for ${provider}`, err);
      }
    }
  }

  storeCache = {
    connections: disk.connections ?? {},
    tokens,
  };

  logger.info(
    `Loaded ${Object.keys(storeCache.connections).length} connection(s)`,
  );
  return storeCache;
}

/** Save or update tokens for a provider */
export async function saveTokens(
  provider: OAuthProvider,
  connection: OAuthConnection,
  tokens: OAuthTokens,
): Promise<void> {
  const disk = await readDiskStore();
  const { key, salt, nonce } = await getEncryptionKey(disk);

  // Update connections metadata (plaintext)
  if (!disk.connections) disk.connections = {};
  disk.connections[provider] = connection;

  // Encrypt tokens
  if (!disk.tokens) disk.tokens = {};
  disk.tokens[provider] = encryptValue(JSON.stringify(tokens), key);

  disk._salt = salt;
  disk._nonce = nonce;

  await writeDiskStore(disk);

  // Update cache
  if (!storeCache) {
    storeCache = { connections: {}, tokens: {} };
  }
  storeCache.connections[provider] = connection;
  storeCache.tokens[provider] = tokens;

  logger.info(`Saved tokens for ${provider} (${connection.accountEmail})`);
}

/** Get tokens for a specific provider */
export async function getTokens(
  provider: OAuthProvider,
): Promise<OAuthTokens | null> {
  const store = await loadTokenStore();
  return store.tokens[provider] ?? null;
}

/** Get connection metadata for a specific provider */
export async function getConnection(
  provider: OAuthProvider,
): Promise<OAuthConnection | null> {
  const store = await loadTokenStore();
  return store.connections[provider] ?? null;
}

/** Get all active connections */
export async function getAllConnections(): Promise<OAuthConnection[]> {
  const store = await loadTokenStore();
  return Object.values(store.connections);
}

/** Remove a provider's tokens and connection */
export async function removeConnection(provider: OAuthProvider): Promise<void> {
  const disk = await readDiskStore();

  if (disk.connections) {
    delete disk.connections[provider];
  }
  if (disk.tokens) {
    delete disk.tokens[provider];
  }

  await writeDiskStore(disk);

  if (storeCache) {
    delete storeCache.connections[provider];
    delete storeCache.tokens[provider];
  }

  logger.info(`Removed connection for ${provider}`);
}

/** Check if a token is expired (with buffer for proactive refresh) */
export function isTokenExpired(tokens: OAuthTokens): boolean {
  return Date.now() >= tokens.expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

/** Invalidate the in-memory cache (e.g., after external changes) */
export function invalidateCache(): void {
  storeCache = null;
}
