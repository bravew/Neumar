import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { dirname } from 'path';

import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { getMcpOAuthTokensPath } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ExternalMcpTokens');

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha512';
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface EncryptedField {
  iv: string;
  data: string;
  tag: string;
}

interface ExternalMcpTokenPayload {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  expiresAt: number | null;
  scopes: string[];
  clientInfo: OAuthClientInformationMixed;
  metadata: AuthorizationServerMetadata;
}

interface DiskExternalMcpTokenRecord {
  serverId: string;
  serverUrl: string;
  authServerBase: string;
  connectedAt: string;
  updatedAt: string;
  expiresAt: number | null;
  scopes: string[];
  tokenType: string;
  payload: EncryptedField;
}

interface DiskExternalMcpTokenStore {
  _salt?: string;
  _nonce?: string;
  records: Record<string, DiskExternalMcpTokenRecord>;
}

export interface ExternalMcpTokenMetadata {
  serverId: string;
  serverUrl: string;
  authServerBase: string;
  connectedAt: string;
  updatedAt: string;
  expiresAt: number | null;
  scopes: string[];
  tokenType: string;
}

export interface SaveExternalMcpTokensInput {
  serverId: string;
  serverUrl: string;
  authServerBase: string;
  clientInfo: OAuthClientInformationMixed;
  metadata: AuthorizationServerMetadata;
  tokens: OAuthTokens;
}

export class ExternalMcpTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalMcpTokenError';
  }
}

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
  const seed = `${os.hostname()}:${os.userInfo().username}:${nonce}`;
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
  disk: DiskExternalMcpTokenStore,
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

async function readDiskStore(): Promise<DiskExternalMcpTokenStore> {
  const configPath = getMcpOAuthTokensPath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<DiskExternalMcpTokenStore>;
    return { ...parsed, records: parsed.records ?? {} };
  } catch {
    return { records: {} };
  }
}

async function writeDiskStore(disk: DiskExternalMcpTokenStore): Promise<void> {
  const configPath = getMcpOAuthTokensPath();
  await fs.mkdir(dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(disk, null, 2), 'utf-8');

  if (os.platform() !== 'win32') {
    await fs.chmod(configPath, 0o600);
  }
}

function toPayload(
  input: Pick<SaveExternalMcpTokensInput, 'clientInfo' | 'metadata' | 'tokens'>,
): ExternalMcpTokenPayload {
  const scopes = input.tokens.scope?.split(/\s+/).filter(Boolean) ?? [];
  const expiresAt =
    typeof input.tokens.expires_in === 'number'
      ? Date.now() + input.tokens.expires_in * 1000
      : null;
  return {
    accessToken: input.tokens.access_token,
    refreshToken: input.tokens.refresh_token ?? null,
    idToken: input.tokens.id_token ?? null,
    tokenType: input.tokens.token_type || 'Bearer',
    expiresAt,
    scopes,
    clientInfo: input.clientInfo,
    metadata: input.metadata,
  };
}

function metadataForRecord(
  record: DiskExternalMcpTokenRecord,
): ExternalMcpTokenMetadata {
  return {
    serverId: record.serverId,
    serverUrl: record.serverUrl,
    authServerBase: record.authServerBase,
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    scopes: record.scopes,
    tokenType: record.tokenType,
  };
}

function shouldRefresh(expiresAt: number | null): boolean {
  return expiresAt !== null && Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

async function readPayload(
  disk: DiskExternalMcpTokenStore,
  record: DiskExternalMcpTokenRecord,
): Promise<ExternalMcpTokenPayload | null> {
  if (!disk._salt || !disk._nonce || !isEncryptedField(record.payload)) {
    return null;
  }
  const { key } = await getEncryptionKey(disk);
  return JSON.parse(
    decryptValue(record.payload, key),
  ) as ExternalMcpTokenPayload;
}

export async function saveExternalMcpTokens(
  input: SaveExternalMcpTokensInput,
): Promise<ExternalMcpTokenMetadata> {
  const disk = await readDiskStore();
  const { key, salt, nonce } = await getEncryptionKey(disk);
  const payload = toPayload(input);
  const previous = disk.records[input.serverId];
  const now = new Date().toISOString();

  disk.records[input.serverId] = {
    serverId: input.serverId,
    serverUrl: input.serverUrl,
    authServerBase: input.authServerBase,
    connectedAt: previous?.connectedAt ?? now,
    updatedAt: now,
    expiresAt: payload.expiresAt,
    scopes: payload.scopes,
    tokenType: payload.tokenType,
    payload: encryptValue(JSON.stringify(payload), key),
  };
  disk._salt = salt;
  disk._nonce = nonce;

  await writeDiskStore(disk);
  logger.info(`Saved encrypted MCP OAuth tokens for "${input.serverId}"`);
  return metadataForRecord(disk.records[input.serverId]!);
}

export async function getExternalMcpTokenMetadata(
  serverId: string,
): Promise<ExternalMcpTokenMetadata | null> {
  const disk = await readDiskStore();
  const record = disk.records[serverId];
  return record ? metadataForRecord(record) : null;
}

export async function getExternalMcpAuthorizationHeader(
  serverId: string,
): Promise<string | null> {
  const disk = await readDiskStore();
  const record = disk.records[serverId];
  if (!record) return null;

  const payload = await readPayload(disk, record);
  if (!payload) return null;

  if (shouldRefresh(payload.expiresAt)) {
    if (!payload.refreshToken) {
      throw new ExternalMcpTokenError('MCP OAuth token has expired');
    }
    try {
      const refreshed = await refreshAuthorization(record.authServerBase, {
        metadata: payload.metadata,
        clientInformation: payload.clientInfo,
        refreshToken: payload.refreshToken,
      });
      const refreshedTokens = {
        ...refreshed,
        scope: refreshed.scope ?? (payload.scopes.join(' ') || undefined),
      };
      const metadata = await saveExternalMcpTokens({
        serverId,
        serverUrl: record.serverUrl,
        authServerBase: record.authServerBase,
        clientInfo: payload.clientInfo,
        metadata: payload.metadata,
        tokens: refreshedTokens,
      });
      const refreshedPayload = toPayload({
        clientInfo: payload.clientInfo,
        metadata: payload.metadata,
        tokens: refreshedTokens,
      });
      return `${metadata.tokenType || 'Bearer'} ${refreshedPayload.accessToken}`;
    } catch (error) {
      logger.warn(`Failed to refresh MCP OAuth token for "${serverId}"`, error);
      throw new ExternalMcpTokenError('MCP OAuth token refresh failed');
    }
  }

  return `${payload.tokenType || 'Bearer'} ${payload.accessToken}`;
}

export async function removeExternalMcpTokens(
  serverId: string,
): Promise<boolean> {
  const disk = await readDiskStore();
  if (!disk.records[serverId]) return false;
  delete disk.records[serverId];
  await writeDiskStore(disk);
  logger.info(`Removed encrypted MCP OAuth tokens for "${serverId}"`);
  return true;
}
