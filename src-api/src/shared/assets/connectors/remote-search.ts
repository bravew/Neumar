import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import {
  cloudStorageRegistry,
  resolveNativeLocalAdapter,
  type CloudStorageAdapter,
} from '@/shared/integrations/cloud-storage';
import { createLogger } from '@/shared/utils/logger';

import { AssetRegistry } from '../registry';
import type { AssetQuery, AssetSearchHit, AssetSource, Page } from '../types';
import {
  cloudFileToRemoteAsset,
  createCloudCatalogConnector,
  type CloudCatalogSource,
} from './immich';
import { listAssetIndexedConnectionIds } from './state';

const logger = createLogger('AssetRemoteSearch');

const CLOUD_CATALOG_SOURCES = [
  'immich',
  'box',
  'google_drive',
  'dropbox',
  'onedrive',
] as const satisfies readonly CloudCatalogSource[];

interface RemoteSearchOptions {
  db?: Database.Database;
  registry?: AssetRegistry;
  resolveAdapter?: (connectionId: string) => CloudStorageAdapter;
}

export async function searchCloudSourceScoped(
  input: AssetQuery,
  options: RemoteSearchOptions = {},
): Promise<Page<AssetSearchHit> | null> {
  const targets = pickCloudSources(input);
  if (targets.length === 0) return null;

  const db = options.db ?? getDatabase();
  const registry = options.registry ?? new AssetRegistry({ db });
  const limit = input.limit ?? 20;

  const hits: AssetSearchHit[] = [];
  let nextCursor: string | null = null;
  let searchedSuccessfully = false;
  for (const source of targets) {
    const connectionIds = listAssetIndexedConnectionIds(source, { db });
    const canPropagateCursor =
      targets.length === 1 && connectionIds.length === 1;
    for (const connectionId of connectionIds) {
      try {
        const adapter =
          options.resolveAdapter?.(connectionId) ??
          resolveNativeLocalAdapter(connectionId) ??
          cloudStorageRegistry.resolve(connectionId);
        const connector = createCloudCatalogConnector(
          source,
          connectionId,
          adapter,
        );
        const page = await connector.search({ ...input, limit });
        searchedSuccessfully = true;
        if (canPropagateCursor) {
          nextCursor = page.nextCursor ?? null;
        } else {
          nextCursor = null;
        }
        for (const [index, file] of page.items.entries()) {
          const remoteInput = cloudFileToRemoteAsset(
            source,
            connectionId,
            file,
          );
          if (!remoteInput) continue;
          const result = registry.upsertRemote(remoteInput);
          hits.push({
            asset: result.asset,
            score: Math.max(0.01, 1 - index / Math.max(page.items.length, 1)),
            scoreBreakdown: { fts: 0 },
            snippet: result.asset.description,
          });
        }
      } catch (error) {
        logger.warn(
          `${source} remote search failed for ${connectionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (hits.length === 0) {
    if (searchedSuccessfully && input.sources?.length) {
      return { items: [], nextCursor };
    }
    return null;
  }
  // Order: keep the per-source ordering, just slice to the requested limit.
  return {
    items: hits.slice(0, limit),
    nextCursor,
  };
}

// Back-compat alias for callers that still target Immich specifically.
export const searchImmichSourceScoped = searchCloudSourceScoped;

function pickCloudSources(input: AssetQuery): CloudCatalogSource[] {
  if (input.tags?.length || input.collectionId || input.attachedTo) return [];
  const requested = input.sources;
  const query = input.text?.trim();
  const allowed = new Set<CloudCatalogSource>(CLOUD_CATALOG_SOURCES);

  if (requested && requested.length > 0) {
    // An explicit source filter — even with an empty query — is a strong
    // signal the user wants live results from that provider (the Cloud
    // Storage tab works the same way without typing). Connectors fall back
    // to `listChildren` when the query is empty.
    return requested.filter(
      (source: AssetSource): source is CloudCatalogSource =>
        allowed.has(source as CloudCatalogSource),
    );
  }

  // No source filter: only fan out across every cloud provider when the
  // user actually typed something. A blank, all-source list view should not
  // hammer every connector in the background.
  if (!query) return [];
  return [...CLOUD_CATALOG_SOURCES];
}
