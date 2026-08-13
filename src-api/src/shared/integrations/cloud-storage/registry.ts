import type Database from 'better-sqlite3';

import {
  createSiteApiClient,
  type SiteApiClient,
} from '@/shared/auth/site-api-client';
import { getDatabase } from '@/shared/db';

import type { CloudStorageAdapter } from './adapter';
import { getCachedConnection } from './cache';
import { CloudStorageError } from './errors';
import type { CloudStorageProvider } from './types';

export interface AdapterFactoryContext {
  connectionId: string;
  siteApiClient: SiteApiClient;
}

export type CloudStorageAdapterFactory = (
  context: AdapterFactoryContext,
) => CloudStorageAdapter;

export class CloudStorageRegistry {
  private readonly factories = new Map<
    CloudStorageProvider,
    CloudStorageAdapterFactory
  >();

  constructor(
    private readonly deps: {
      getDb?: () => Database.Database;
      createClient?: () => SiteApiClient;
    } = {},
  ) {}

  register(
    provider: CloudStorageProvider,
    factory: CloudStorageAdapterFactory,
  ): void {
    this.factories.set(provider, factory);
  }

  unregister(provider: CloudStorageProvider): void {
    this.factories.delete(provider);
  }

  clear(): void {
    this.factories.clear();
  }

  has(provider: CloudStorageProvider): boolean {
    return this.factories.has(provider);
  }

  resolve(connectionId: string): CloudStorageAdapter {
    const db = this.deps.getDb?.() ?? getDatabase();
    const connection = getCachedConnection(connectionId, db);
    if (!connection) {
      throw new CloudStorageError(
        'not_found',
        `Cloud storage connection ${connectionId} is not cached`,
      );
    }

    const factory = this.factories.get(connection.provider);
    if (!factory) {
      throw new CloudStorageError(
        'unsupported',
        `No cloud storage adapter registered for ${connection.provider}`,
      );
    }

    return factory({
      connectionId,
      siteApiClient: this.deps.createClient?.() ?? createSiteApiClient(),
    });
  }
}

export const cloudStorageRegistry = new CloudStorageRegistry();
