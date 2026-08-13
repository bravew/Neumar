/**
 * Slack Config Manager
 *
 * Manages Slack integration configuration with encrypted secret storage.
 * Secrets are encrypted at rest using AES-256-GCM with per-field unique IVs.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { dirname, join } from 'path';

import { getAppDir } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlackConfig');

// ============================================================================
// Types
// ============================================================================

export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  appToken: string;
  botToken: string;
  userToken: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  authedUserId: string;
  authedUserEmail: string;
  gateway: {
    enabled: boolean;
    autoStart: boolean;
    listenToDMs: boolean;
    listenToMentions: boolean;
    defaultChannel: string | null;
  };
  connectedAt: string;
}

interface EncryptedField {
  iv: string;
  data: string;
  tag: string;
}

interface DiskConfig {
  clientId?: string;
  clientSecret?: EncryptedField | string;
  appToken?: EncryptedField | string;
  botToken?: EncryptedField | string;
  userToken?: EncryptedField | string;
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  authedUserId?: string;
  authedUserEmail?: string;
  gateway?: {
    enabled?: boolean;
    autoStart?: boolean;
    listenToDMs?: boolean;
    listenToMentions?: boolean;
    defaultChannel?: string | null;
  };
  connectedAt?: string;
  _salt?: string;
  _nonce?: string;
}

// ============================================================================
// Constants
// ============================================================================

export const SLACK_CONFIG_FILE_NAME = 'slack-config.enc.json';

const SENSITIVE_FIELDS = [
  'clientSecret',
  'appToken',
  'botToken',
  'userToken',
] as const;

/** PBKDF2 parameters for key derivation */
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BYTES = 32;
const PBKDF2_DIGEST = 'sha512';

/** Salt and IV sizes for AES-256-GCM */
const SALT_LENGTH_BYTES = 32;
const NONCE_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

const DEFAULT_GATEWAY = {
  enabled: false,
  autoStart: false,
  listenToDMs: true,
  listenToMentions: true,
  defaultChannel: null as string | null,
};

export const defaultSlackConfig: SlackConfig = {
  clientId: '',
  clientSecret: '',
  appToken: '',
  botToken: '',
  userToken: '',
  teamId: '',
  teamName: '',
  botUserId: '',
  authedUserId: '',
  authedUserEmail: '',
  gateway: { ...DEFAULT_GATEWAY },
  connectedAt: '',
};

// ============================================================================
// Path helpers
// ============================================================================

/** Get Slack config file path */
export function getSlackConfigPath(): string {
  return join(getAppDir(), SLACK_CONFIG_FILE_NAME);
}

// ============================================================================
// Module-level state
// ============================================================================

let configCache: SlackConfig | null = null;

// ============================================================================
// Encryption helpers
// ============================================================================

function encryptField(value: string, key: Buffer): EncryptedField {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
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

function decryptField(encrypted: EncryptedField, key: Buffer): string {
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
      KEY_LENGTH_BYTES,
      PBKDF2_DIGEST,
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}

async function getEncryptionKey(
  diskConfig: DiskConfig,
): Promise<{ key: Buffer; salt: string; nonce: string }> {
  let salt: Buffer;
  let nonce: string;

  if (diskConfig._salt && diskConfig._nonce) {
    salt = Buffer.from(diskConfig._salt, 'base64');
    nonce = diskConfig._nonce;
  } else {
    salt = crypto.randomBytes(SALT_LENGTH_BYTES);
    nonce = crypto.randomBytes(NONCE_LENGTH_BYTES).toString('base64');
  }

  const key = await deriveKey(salt, nonce);
  return { key, salt: salt.toString('base64'), nonce };
}

// ============================================================================
// Public API
// ============================================================================

/** Load config from disk, decrypt secrets, return defaults for missing fields */
export async function loadSlackConfig(): Promise<SlackConfig> {
  const configPath = getSlackConfigPath();

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const diskConfig: DiskConfig = JSON.parse(content);
    const { key } = await getEncryptionKey(diskConfig);

    const config: SlackConfig = { ...defaultSlackConfig };

    // Load plaintext fields
    if (diskConfig.clientId !== undefined)
      config.clientId = diskConfig.clientId;
    if (diskConfig.teamId !== undefined) config.teamId = diskConfig.teamId;
    if (diskConfig.teamName !== undefined)
      config.teamName = diskConfig.teamName;
    if (diskConfig.botUserId !== undefined)
      config.botUserId = diskConfig.botUserId;
    if (diskConfig.authedUserId !== undefined)
      config.authedUserId = diskConfig.authedUserId;
    if (diskConfig.authedUserEmail !== undefined)
      config.authedUserEmail = diskConfig.authedUserEmail;
    if (diskConfig.connectedAt !== undefined)
      config.connectedAt = diskConfig.connectedAt;

    // Load gateway
    if (diskConfig.gateway) {
      config.gateway = {
        ...DEFAULT_GATEWAY,
        ...diskConfig.gateway,
      };
    }

    // Decrypt sensitive fields
    for (const field of SENSITIVE_FIELDS) {
      const value = diskConfig[field];
      if (isEncryptedField(value)) {
        try {
          config[field] = decryptField(value, key);
        } catch (err) {
          logger.warn(`Failed to decrypt ${field}, using default`, err);
          config[field] = '';
        }
      } else if (typeof value === 'string') {
        config[field] = value;
      }
    }

    configCache = config;
    logger.info('Config loaded successfully');
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info('No config file found, using defaults');
    } else {
      logger.error('Failed to load config', err);
    }
    configCache = { ...defaultSlackConfig };
    return configCache;
  }
}

/** Merge partial updates, encrypt secrets, write to disk */
export async function saveSlackConfig(
  updates: Partial<SlackConfig>,
): Promise<void> {
  const configPath = getSlackConfigPath();

  // Load existing disk config for salt/nonce preservation
  let diskConfig: DiskConfig = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    diskConfig = JSON.parse(content);
  } catch {
    // No existing config
  }

  // Merge with current cache
  const current = configCache ?? { ...defaultSlackConfig };
  const merged: SlackConfig = {
    ...current,
    ...updates,
    gateway: {
      ...DEFAULT_GATEWAY,
      ...current.gateway,
      ...(updates.gateway ?? {}),
    },
  };
  configCache = merged;

  // Get encryption key
  const { key, salt, nonce } = await getEncryptionKey(diskConfig);

  // Build disk representation
  const toDisk: DiskConfig = {
    clientId: merged.clientId,
    teamId: merged.teamId,
    teamName: merged.teamName,
    botUserId: merged.botUserId,
    authedUserId: merged.authedUserId,
    authedUserEmail: merged.authedUserEmail,
    gateway: merged.gateway,
    connectedAt: merged.connectedAt,
    _salt: salt,
    _nonce: nonce,
  };

  // Encrypt sensitive fields
  for (const field of SENSITIVE_FIELDS) {
    const value = merged[field];
    if (value) {
      toDisk[field] = encryptField(value, key);
    } else {
      toDisk[field] = '';
    }
  }

  // Write to disk
  await fs.mkdir(dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(toDisk, null, 2), 'utf-8');

  // Set file permissions (owner read/write only) on Unix/macOS
  if (os.platform() !== 'win32') {
    await fs.chmod(configPath, 0o600);
  }

  logger.info('Config saved successfully');
}

/** Sync getter from cache (call loadSlackConfig on startup first) */
export function getSlackConfig(): SlackConfig {
  if (!configCache) {
    logger.warn('Config not loaded yet, returning defaults');
    return { ...defaultSlackConfig };
  }
  return configCache;
}

/** Clear config cache and delete config file from disk */
export async function clearSlackConfig(): Promise<void> {
  configCache = null;
  const configPath = getSlackConfigPath();
  try {
    await fs.unlink(configPath);
    logger.info('Slack config cleared');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to delete config file', err);
    }
  }
}
