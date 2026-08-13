import crypto from 'crypto';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';

import {
  getCachedConnection,
  upsertCachedConnections,
  type SiteConnection,
} from '../cache';
import { CloudStorageError } from '../errors';
import type { Capabilities } from '../types';
import { validatePersonalMediaBaseUrl } from './url-policy';

const INDEX_KEY = 'cloud_storage_personal_media_connection_ids';
const CREDENTIAL_KEY_PREFIX = 'cloud_storage_personal_media_credential:';

export interface LocalPersonalMediaCredential {
  credentialId: string;
  provider: 'immich';
  baseUrl: string;
  apiKey: string;
  serverVersion?: string;
  serverInstanceId?: string;
  userId?: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPersonalMediaCreateInput {
  provider: 'immich';
  kind?: 'personal-media';
  displayName?: string;
  credential: {
    baseUrl: string;
    apiKey: string;
    serverVersion?: string;
    serverInstanceId?: string;
    userId?: string;
  };
}

export interface LocalPersonalMediaUpdateInput {
  displayName?: string;
  credential?: {
    baseUrl?: string;
    apiKey?: string;
    serverVersion?: string;
    serverInstanceId?: string;
    userId?: string;
  };
}

export interface LocalPersonalMediaConnectionDetails extends SiteConnection {
  credential: {
    baseUrl: string;
    serverVersion?: string;
    serverInstanceId?: string;
    userId?: string;
  };
  updatedAt: string;
}

export class LocalPersonalMediaStore {
  constructor(private readonly db: Database.Database = getDatabase()) {}

  create(input: LocalPersonalMediaCreateInput): SiteConnection {
    const baseUrlResult = validatePersonalMediaBaseUrl(
      input.credential.baseUrl,
      { allowLan: true },
    );
    if (!baseUrlResult.valid) {
      throw new CloudStorageError(
        'permission_denied',
        'Personal media base URL is blocked',
        { details: baseUrlResult.reason },
      );
    }

    const now = new Date().toISOString();
    const id = `local_immich_${crypto.randomUUID()}`;
    const displayName = input.displayName?.trim() || 'Immich';
    const credential: LocalPersonalMediaCredential = {
      credentialId: id,
      provider: 'immich',
      baseUrl: input.credential.baseUrl.trim(),
      apiKey: input.credential.apiKey.trim(),
      serverVersion: optionalString(input.credential.serverVersion),
      serverInstanceId: optionalString(input.credential.serverInstanceId),
      userId: optionalString(input.credential.userId),
      displayName,
      createdAt: now,
      updatedAt: now,
    };

    this.setJson(credentialKey(id), credential);
    this.setJson(INDEX_KEY, [...new Set([...this.ids(), id])]);

    const connection = localConnectionFromCredential(credential, this.db);
    upsertCachedConnections([connection], this.db);
    return connection;
  }

  update(
    connectionId: string,
    input: LocalPersonalMediaUpdateInput,
  ): SiteConnection | null {
    const current = this.getCredential(connectionId);
    if (!current) return null;

    const nextBaseUrl =
      optionalString(input.credential?.baseUrl) ?? current.baseUrl;
    const baseUrlResult = validatePersonalMediaBaseUrl(nextBaseUrl, {
      allowLan: true,
    });
    if (!baseUrlResult.valid) {
      throw new CloudStorageError(
        'permission_denied',
        'Personal media base URL is blocked',
        { details: baseUrlResult.reason },
      );
    }

    const credential: LocalPersonalMediaCredential = {
      ...current,
      baseUrl: nextBaseUrl,
      apiKey: optionalString(input.credential?.apiKey) ?? current.apiKey,
      displayName:
        input.displayName === undefined
          ? current.displayName
          : input.displayName.trim() || 'Immich',
      serverVersion:
        optionalString(input.credential?.serverVersion) ??
        current.serverVersion,
      serverInstanceId:
        optionalString(input.credential?.serverInstanceId) ??
        current.serverInstanceId,
      userId: optionalString(input.credential?.userId) ?? current.userId,
      updatedAt: new Date().toISOString(),
    };

    this.setJson(credentialKey(connectionId), credential);
    const connection = localConnectionFromCredential(credential, this.db);
    upsertCachedConnections([connection], this.db);
    return connection;
  }

  listConnections(): SiteConnection[] {
    return this.ids()
      .map((id) => this.getCredential(id))
      .filter((value): value is LocalPersonalMediaCredential => Boolean(value))
      .map((credential) => localConnectionFromCredential(credential, this.db));
  }

  getConnectionDetails(
    connectionId: string,
  ): LocalPersonalMediaConnectionDetails | null {
    const credential = this.getCredential(connectionId);
    if (!credential) return null;

    return {
      ...localConnectionFromCredential(credential, this.db),
      credential: {
        baseUrl: credential.baseUrl,
        serverVersion: credential.serverVersion,
        serverInstanceId: credential.serverInstanceId,
        userId: credential.userId,
      },
      updatedAt: credential.updatedAt,
    };
  }

  getCredential(connectionId: string): LocalPersonalMediaCredential | null {
    return parseCredential(this.getJson(credentialKey(connectionId)));
  }

  has(connectionId: string): boolean {
    return this.getCredential(connectionId) !== null;
  }

  delete(connectionId: string): boolean {
    if (!this.has(connectionId)) return false;

    this.db
      .prepare('DELETE FROM settings WHERE key = ?')
      .run(credentialKey(connectionId));
    this.setJson(
      INDEX_KEY,
      this.ids().filter((id) => id !== connectionId),
    );
    this.db
      .prepare('DELETE FROM cloud_storage_connections_cache WHERE id = ?')
      .run(connectionId);
    return true;
  }

  ensureCached(): void {
    const connections = this.listConnections();
    if (connections.length) upsertCachedConnections(connections, this.db);
  }

  private ids(): string[] {
    const parsed = this.getJson(INDEX_KEY);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is string =>
        typeof value === 'string' && value.startsWith('local_immich_'),
    );
  }

  private getJson(key: string): unknown {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    if (!row) return undefined;

    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return undefined;
    }
  }

  private setJson(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(key, JSON.stringify(value));
  }
}

export function isLocalPersonalMediaCreateInput(
  value: unknown,
): value is LocalPersonalMediaCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.provider !== 'immich') return false;
  if (record.kind !== undefined && record.kind !== 'personal-media') {
    return false;
  }
  if (
    record.displayName !== undefined &&
    typeof record.displayName !== 'string'
  ) {
    return false;
  }
  const credential = record.credential;
  if (
    !credential ||
    typeof credential !== 'object' ||
    Array.isArray(credential)
  ) {
    return false;
  }
  const credentialRecord = credential as Record<string, unknown>;
  return (
    typeof credentialRecord.baseUrl === 'string' &&
    credentialRecord.baseUrl.trim() !== '' &&
    typeof credentialRecord.apiKey === 'string' &&
    credentialRecord.apiKey.trim() !== ''
  );
}

export function isLocalPersonalMediaUpdateInput(
  value: unknown,
): value is LocalPersonalMediaUpdateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.displayName !== undefined &&
    typeof record.displayName !== 'string'
  ) {
    return false;
  }
  const credential = record.credential;
  if (credential === undefined) return true;
  if (typeof credential !== 'object' || Array.isArray(credential)) {
    return false;
  }
  const credentialRecord = credential as Record<string, unknown>;
  return [
    credentialRecord.baseUrl,
    credentialRecord.apiKey,
    credentialRecord.serverVersion,
    credentialRecord.serverInstanceId,
    credentialRecord.userId,
  ].every((field) => field === undefined || typeof field === 'string');
}

export function getLocalPersonalMediaCredential(
  connectionId: string,
  db?: Database.Database,
): LocalPersonalMediaCredential | null {
  return new LocalPersonalMediaStore(db ?? getDatabase()).getCredential(
    connectionId,
  );
}

export function isLocalPersonalMediaConnection(
  connectionId: string,
  db?: Database.Database,
): boolean {
  return new LocalPersonalMediaStore(db ?? getDatabase()).has(connectionId);
}

function localConnectionFromCredential(
  credential: LocalPersonalMediaCredential,
  db: Database.Database,
): SiteConnection {
  const cached = getCachedConnection(credential.credentialId, db);
  return {
    id: credential.credentialId,
    provider: credential.provider,
    displayName: credential.displayName ?? 'Immich',
    status: cached?.status ?? 'active',
    capabilities: personalMediaCapabilities(),
    connectedAt: credential.createdAt,
  };
}

function personalMediaCapabilities(): Capabilities & {
  preferredView: 'media-grid';
  selfHostedBaseUrl: true;
  mediaKinds: Array<'image' | 'video'>;
} {
  return {
    fullTextSearch: true,
    thumbnails: true,
    exportContent: false,
    watch: false,
    longPoll: true,
    sharedDrives: false,
    preferredView: 'media-grid',
    selfHostedBaseUrl: true,
    mediaKinds: ['image', 'video'],
    mediaMetadata: {
      structuredSearch: true,
      writableFields: ['description', 'isFavorite', 'rating', 'tags'],
    },
  };
}

function parseCredential(value: unknown): LocalPersonalMediaCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const credentialId = parseString(record.credentialId);
  const provider = parseString(record.provider);
  const baseUrl = parseString(record.baseUrl);
  const apiKey = parseString(record.apiKey);
  const createdAt = parseString(record.createdAt);
  const updatedAt = parseString(record.updatedAt);
  if (
    !credentialId ||
    provider !== 'immich' ||
    !baseUrl ||
    !apiKey ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    credentialId,
    provider,
    baseUrl,
    apiKey,
    createdAt,
    updatedAt,
    displayName: parseString(record.displayName),
    serverVersion: parseString(record.serverVersion),
    serverInstanceId: parseString(record.serverInstanceId),
    userId: parseString(record.userId),
  };
}

function credentialKey(connectionId: string): string {
  return `${CREDENTIAL_KEY_PREFIX}${connectionId}`;
}

function optionalString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}
