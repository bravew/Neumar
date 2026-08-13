import {
  createSiteApiClient,
  type SiteApiClient,
} from '@/shared/auth/site-api-client';
import { getSiteSession } from '@/shared/auth/site-auth';
import { createLogger } from '@/shared/utils/logger';

import {
  markCachedConnectionsNeedsReauth,
  type SiteConnection,
  upsertCachedConnections,
} from './cache';
import { CloudStorageError } from './errors';
import { LocalPersonalMediaStore } from './personal-media/local-personal-media-store';

const logger = createLogger('CloudStorage:Bootstrap');

interface ConnectionsResponse {
  connections?: SiteConnection[];
  items?: SiteConnection[];
}

export async function bootstrapCloudStorageConnectionsCache(
  client: SiteApiClient = createSiteApiClient(),
): Promise<void> {
  new LocalPersonalMediaStore().ensureCached();

  const session = await getSiteSession();
  if (!session) return;

  try {
    const response = await client.getJson<
      ConnectionsResponse | SiteConnection[]
    >('/api/cloud-storage/connections');
    const connections = Array.isArray(response)
      ? response
      : (response.connections ?? response.items ?? []);
    upsertCachedConnections(connections);
    logger.info(`Cached ${connections.length} cloud storage connection(s)`);
  } catch (error) {
    if (error instanceof CloudStorageError && error.code === 'auth_revoked') {
      markCachedConnectionsNeedsReauth();
      logger.warn(
        'Site auth revoked; marked cached cloud connections for reauth',
      );
      return;
    }

    if (
      error instanceof CloudStorageError &&
      error.code === 'site_unreachable'
    ) {
      logger.warn('Site unreachable; preserving cloud connection cache');
      return;
    }

    logger.warn('Cloud storage cache bootstrap failed', error);
  }
}
