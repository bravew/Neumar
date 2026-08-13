import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { GOOGLE_DRIVE_SCOPES } from '@/config/oauth';

import {
  AssetsError,
  clearAssetConnectionIndexing,
  getAssetConnectionCatalogStatus,
  removeAssetSyncState,
  setAssetConnectionIndexingEnabled,
  syncAssetsConnection,
  type AssetCatalogConnectionStatus,
  type AssetSyncMode,
  type AssetSyncResult,
} from '@/shared/assets';
import {
  createSiteApiClient,
  type SiteApiClient,
} from '@/shared/auth/site-api-client';
import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import {
  cloudStorageRegistry,
  getCachedConnection,
  isCloudStorageError,
  type SiteConnection,
} from '@/shared/integrations/cloud-storage';
import {
  isPersonalMediaConnectionTestInput,
  testDesktopPersonalMediaConnection,
} from '@/shared/integrations/cloud-storage/personal-media/connection-test';
import {
  detectTailscale,
  discoverNetworkMounts,
  PathMappingsStore,
  resolveBridgePath,
  verifyBridgeMapping,
  type BridgeResolution,
  type BridgeVerificationResult,
  type ImmichBridgeAsset,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';
import { validatePersonalMediaLocalPathPolicy } from '@/shared/integrations/cloud-storage/personal-media/local-path-policy';
import {
  isLocalPersonalMediaCreateInput,
  isLocalPersonalMediaUpdateInput,
  LocalPersonalMediaStore,
} from '@/shared/integrations/cloud-storage/personal-media/local-personal-media-store';
import { BoxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/box-local-adapter';
import { DropboxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/dropbox-local-adapter';
import { GoogleDriveLocalAdapter } from '@/shared/integrations/cloud-storage/providers/google-drive-local-adapter';
import { OneDriveLocalAdapter } from '@/shared/integrations/cloud-storage/providers/onedrive-local-adapter';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CloudStorageRoutes');

interface CloudStorageRouteDeps {
  createClient?: () => SiteApiClient;
  createLocalPersonalMediaStore?: () => LocalPersonalMediaStore;
  createPathMappingsStore?: () => PathMappingsStore;
  detectTailscale?: typeof detectTailscale;
  discoverNetworkMounts?: typeof discoverNetworkMounts;
  fetchFn?: typeof fetch;
  personalMediaTestTimeoutMs?: number;
  resolveLocalAdapter?: (connectionId: string) => CloudStorageAdapter | null;
  getAssetCatalogStatus?: (
    source: 'immich',
    connectionId: string,
  ) => AssetCatalogConnectionStatus;
  setAssetCatalogIndexing?: (
    source: 'immich',
    connectionId: string,
    enabled: boolean,
  ) => void;
  syncAssetCatalogConnection?: (input: {
    source: 'immich';
    connectionId: string;
    mode?: AssetSyncMode;
    limit?: number;
  }) => Promise<AssetSyncResult>;
  clearAssetCatalogConnection?: (
    source: 'immich',
    connectionId: string,
  ) => void;
}

// Most mutating routes either forward an opaque JSON object to the trusted
// site API or discriminate the object shape with helper guards in the handler.
// A permissive object schema satisfies the project's "every mutating route
// must use zValidator" rule while rejecting non-JSON / non-object bodies,
// without changing the downstream shape contract.
const jsonObjectSchema = z.record(z.string(), z.unknown());
// `roots` may legitimately be an object or an array, so accept either.
const jsonObjectOrArraySchema = z.union([
  jsonObjectSchema,
  z.array(z.unknown()),
]);

const PERSONAL_MEDIA_PROVIDERS = new Set(['immich', 'photoprism']);
const GOOGLE_DRIVE_LOCAL_ID = 'local_google_drive';
const BOX_LOCAL_ID = 'local_box';
const DROPBOX_LOCAL_ID = 'local_dropbox';
const ONEDRIVE_LOCAL_ID = 'local_onedrive';

const NATIVE_CLOUD_CONNECTED_AT_SENTINEL = '1970-01-01T00:00:00.000Z';

interface ConnectionsResponse {
  connections?: AssetCatalogSiteConnection[];
  items?: AssetCatalogSiteConnection[];
  featureEnabled?: boolean;
  wakeupMode?: string;
  [key: string]: unknown;
}

interface AssetCatalogSiteConnection extends SiteConnection {
  assetsCatalog?: AssetCatalogConnectionStatus;
}

export function createCloudStorageRoutes(deps: CloudStorageRouteDeps = {}) {
  const cloudStorageRoutes = new Hono();
  const client = deps.createClient ?? (() => createSiteApiClient());
  const localPersonalMediaStore =
    deps.createLocalPersonalMediaStore ?? (() => new LocalPersonalMediaStore());
  const detectTailscaleStatus = deps.detectTailscale ?? detectTailscale;
  const discoverMounts = deps.discoverNetworkMounts ?? discoverNetworkMounts;
  const pathMappingsStore =
    deps.createPathMappingsStore ?? (() => new PathMappingsStore());
  const resolveLocalAdapter =
    deps.resolveLocalAdapter ?? defaultResolveLocalAdapter;
  const getAssetCatalogStatus =
    deps.getAssetCatalogStatus ?? defaultGetAssetCatalogStatus;
  const setAssetCatalogIndexing =
    deps.setAssetCatalogIndexing ?? defaultSetAssetCatalogIndexing;
  const syncAssetCatalogConnection =
    deps.syncAssetCatalogConnection ?? defaultSyncAssetCatalogConnection;
  const clearAssetCatalogConnection =
    deps.clearAssetCatalogConnection ?? defaultClearAssetCatalogConnection;

  cloudStorageRoutes.get('/connections', async (c) => {
    const personalConnections = localPersonalMediaStore().listConnections();
    const nativeCloudConnections = await listNativeCloudConnections();
    const localConnections = [
      ...nativeCloudConnections,
      ...personalConnections,
    ];
    try {
      const response = await client().getJson<ConnectionsResponse>(
        '/api/cloud-storage/connections',
      );
      return c.json(
        mergeConnectionsResponse(
          response,
          localConnections,
          getAssetCatalogStatus,
        ),
      );
    } catch (error) {
      if (canServeLocalConnectionsOnly(error)) {
        return c.json(
          localConnectionsResponse(localConnections, getAssetCatalogStatus),
        );
      }
      throw error;
    }
  });

  cloudStorageRoutes.post(
    '/connections',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      const body = c.req.valid('json');
      if (isLocalPersonalMediaCreateInput(body)) {
        try {
          return c.json({ item: localPersonalMediaStore().create(body) }, 201);
        } catch (error) {
          return cloudStorageErrorResponse(c, error);
        }
      }

      return c.json(
        await client().postJson('/api/cloud-storage/connections', body),
        201,
      );
    },
  );

  cloudStorageRoutes.post(
    '/connections/test',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      const body = c.req.valid('json');
      if (isPersonalMediaConnectionTestInput(body)) {
        const result = await testDesktopPersonalMediaConnection(body, {
          fetchFn: deps.fetchFn,
          timeoutMs: deps.personalMediaTestTimeoutMs,
        });
        const status: ContentfulStatusCode = result.ok ? 200 : 400;
        return c.json(result, status);
      }

      return c.json(
        await client().postJson('/api/cloud-storage/connections/test', body),
      );
    },
  );

  cloudStorageRoutes.get('/connections/:id', async (c) => {
    const connectionId = c.req.param('id');
    const localDetails =
      localPersonalMediaStore().getConnectionDetails(connectionId);
    if (localDetails) {
      return c.json({ item: localDetails });
    }

    return c.json(
      await client().getJson(`/api/cloud-storage/connections/${connectionId}`),
    );
  });

  cloudStorageRoutes.patch('/connections/:id', async (c) => {
    const connectionId = c.req.param('id');
    const parsedBody = await readJsonRecordBody(c);
    if (!parsedBody.ok) return c.json({ error: parsedBody.error }, 400);
    const body = parsedBody.body;
    const localStore = localPersonalMediaStore();

    if (localStore.has(connectionId)) {
      if (!isLocalPersonalMediaUpdateInput(body)) {
        return c.json({ error: 'invalid_personal_media_update' }, 400);
      }

      try {
        const updated = localStore.update(connectionId, body);
        return c.json({ item: updated });
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    return c.json(
      await client().patchJson(
        `/api/cloud-storage/connections/${connectionId}`,
        body,
      ),
    );
  });

  cloudStorageRoutes.post(
    '/oauth/desktop-start',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      return c.json(
        await client().postJson(
          '/api/cloud-storage/oauth/desktop-start',
          c.req.valid('json'),
        ),
      );
    },
  );

  cloudStorageRoutes.delete('/connections/:id', async (c) => {
    const id = c.req.param('id');
    if (localPersonalMediaStore().delete(id)) {
      clearAssetCatalogConnection('immich', id);
      return c.json({ ok: true });
    }

    const nativeProvider = nativeProviderForLocalId(id);
    if (nativeProvider) {
      const oauthClient = await import('@/shared/auth/oauth-client');
      try {
        await oauthClient.revokeConnection(nativeProvider);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to revoke ${nativeProvider} connection`, err);
        return c.json(
          {
            ok: false,
            error: `Failed to revoke ${nativeProvider}: ${message}`,
          },
          502 as ContentfulStatusCode,
        );
      }
      return c.json({ ok: true });
    }

    return c.json(await client().del(`/api/cloud-storage/connections/${id}`));
  });

  cloudStorageRoutes.get('/connections/:id/roots', async (c) => {
    return c.json(
      await client().getJson(
        `/api/cloud-storage/connections/${c.req.param('id')}/roots`,
      ),
    );
  });

  cloudStorageRoutes.put(
    '/connections/:id/roots',
    zValidator('json', jsonObjectOrArraySchema),
    async (c) => {
      return c.json(
        await client().putJson(
          `/api/cloud-storage/connections/${c.req.param('id')}/roots`,
          c.req.valid('json'),
        ),
      );
    },
  );

  cloudStorageRoutes.get('/connections/:id/path-mappings', async (c) => {
    return c.json({
      items: pathMappingsStore().list(c.req.param('id')),
    });
  });

  cloudStorageRoutes.get(
    '/connections/:id/path-mappings/discovery',
    async (c) => {
      const [mounts, tailscale] = await Promise.all([
        discoverMounts(),
        detectTailscaleStatus(),
      ]);
      return c.json({ mounts, tailscale });
    },
  );

  cloudStorageRoutes.post(
    '/connections/:id/path-mappings',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      const parsed = parsePathMappingBody(
        c.req.param('id'),
        c.req.valid('json'),
      );
      if ('error' in parsed) {
        return c.json({ error: parsed.error }, 400);
      }

      const policy = await validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: parsed.input.immichPathPrefix,
        localMountPath: parsed.input.localMountPath,
      });
      if (!policy.valid) {
        return c.json({ error: policy.reason ?? 'invalid_path_mapping' }, 400);
      }

      return c.json(pathMappingsStore().upsert(parsed.input), 201);
    },
  );

  cloudStorageRoutes.patch(
    '/connections/:id/path-mappings/:mappingId',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      const current = pathMappingsStore().getForConnection(
        c.req.param('id'),
        c.req.param('mappingId'),
      );
      if (!current) {
        return c.json({ error: 'path_mapping_not_found' }, 404);
      }

      const body = c.req.valid('json');
      const pathsChanged =
        (typeof body.localMountPath === 'string' &&
          body.localMountPath !== current.localMountPath) ||
        (typeof body.immichPathPrefix === 'string' &&
          body.immichPathPrefix !== current.immichPathPrefix);

      // Verification status can never be set by the client — it is only ever
      // produced by the verify endpoint. Strip these fields from the request
      // body before merging so a caller cannot forge `verified: true`.
      const {
        verified: _verified,
        verifiedAt: _verifiedAt,
        verificationHash: _verificationHash,
        ...sanitizedBody
      } = body;

      const merged: Record<string, unknown> = {
        ...current,
        ...sanitizedBody,
        id: current.id,
      };
      if (pathsChanged) {
        merged.verified = false;
        merged.verifiedAt = undefined;
        merged.verificationHash = undefined;
      }

      const parsed = parsePathMappingBody(c.req.param('id'), merged);
      if ('error' in parsed) {
        return c.json({ error: parsed.error }, 400);
      }

      const policy = await validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: parsed.input.immichPathPrefix,
        localMountPath: parsed.input.localMountPath,
      });
      if (!policy.valid) {
        return c.json({ error: policy.reason ?? 'invalid_path_mapping' }, 400);
      }

      return c.json(pathMappingsStore().upsert(parsed.input));
    },
  );

  cloudStorageRoutes.delete(
    '/connections/:id/path-mappings/:mappingId',
    async (c) => {
      const deleted = pathMappingsStore().deleteForConnection(
        c.req.param('id'),
        c.req.param('mappingId'),
      );
      if (!deleted) {
        return c.json({ error: 'path_mapping_not_found' }, 404);
      }
      return c.json({ ok: true });
    },
  );

  cloudStorageRoutes.post(
    '/connections/:id/path-mappings/resolve-test',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      const body = c.req.valid('json');
      const asset = parseBridgeAsset(body);
      if (!asset) {
        return c.json({ error: 'invalid_asset' }, 400);
      }

      const candidate = parseCandidatePathMapping(c.req.param('id'), body);
      if (candidate) {
        const policy = await validatePersonalMediaLocalPathPolicy({
          immichPathPrefix: candidate.immichPathPrefix,
          localMountPath: candidate.localMountPath,
        });
        if (!policy.valid) {
          return c.json(
            { error: policy.reason ?? 'invalid_path_mapping' },
            400,
          );
        }
        const result = await verifyBridgeMapping({
          asset,
          mapping: candidate,
        });
        return c.json(sanitizeVerificationResult(result));
      }

      return c.json(
        sanitizeBridgeResolution(
          await resolveBridgePath({
            asset,
            mappings: pathMappingsStore().list(c.req.param('id'), false),
          }),
        ),
      );
    },
  );

  cloudStorageRoutes.get('/connections/:id/timeline/buckets', async (c) => {
    const size = c.req.query('size') === 'day' ? 'day' : 'month';
    const adapter = resolveLocalAdapter(c.req.param('id'));
    if (adapter) {
      if (!adapter.getTimelineBuckets) {
        return c.json({ size, buckets: [], supported: false });
      }
      try {
        const result = await adapter.getTimelineBuckets({ size });
        return c.json({ ...result, supported: true });
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    try {
      return c.json(
        await client().getJson(
          withQuery(
            `/api/cloud-storage/connections/${c.req.param('id')}/timeline/buckets`,
            c,
          ),
        ),
      );
    } catch (error) {
      if (isCloudStorageError(error) && error.status === 404) {
        return c.json({ size, buckets: [], supported: false });
      }
      return cloudStorageErrorResponse(c, error);
    }
  });

  cloudStorageRoutes.get('/connections/:id/items', async (c) => {
    const adapter = resolveLocalAdapter(c.req.param('id'));
    if (adapter) {
      try {
        return c.json(await adapter.listChildren(parseListChildrenInput(c)));
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    return c.json(
      await client().getJson(
        withQuery(
          `/api/cloud-storage/connections/${c.req.param('id')}/items`,
          c,
        ),
      ),
    );
  });

  cloudStorageRoutes.post(
    '/connections/:id/items',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      const body = c.req.valid('json');
      const adapter = resolveLocalAdapter(c.req.param('id'));
      if (adapter) {
        try {
          const name = parseNonEmptyString(body.name);
          if (!name) return c.json({ error: 'invalid_folder_name' }, 400);
          return c.json(
            await adapter.createFolder(
              optionalNullableString(body.parentId) ?? null,
              name,
            ),
            201,
          );
        } catch (error) {
          return cloudStorageErrorResponse(c, error);
        }
      }

      return c.json(
        await client().postJson(
          `/api/cloud-storage/connections/${c.req.param('id')}/items`,
          body,
        ),
      );
    },
  );

  cloudStorageRoutes.put('/connections/:id/items', async (c) => {
    const adapter = resolveLocalAdapter(c.req.param('id'));
    if (adapter) {
      try {
        const form = await c.req.formData();
        const file = form.get('file');
        if (!(file instanceof Blob)) {
          return c.json({ error: 'invalid_upload_file' }, 400);
        }
        const fileName =
          'name' in file && typeof file.name === 'string'
            ? file.name
            : undefined;
        const name = stringFromForm(form.get('name')) ?? fileName;
        if (!name) return c.json({ error: 'invalid_upload_name' }, 400);
        return c.json(
          await adapter.upload({
            parentId: stringFromForm(form.get('parentId')) ?? null,
            name,
            content: file,
            mimeType: stringFromForm(form.get('mimeType')) ?? file.type,
            overwrite: booleanFromForm(form.get('overwrite')),
            metadata: metadataFromForm(form.get('metadata')),
          }),
        );
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    return c.json(
      await client().putForm(
        `/api/cloud-storage/connections/${c.req.param('id')}/items`,
        await c.req.formData(),
      ),
    );
  });

  cloudStorageRoutes.get('/connections/:id/search', async (c) => {
    const adapter = resolveLocalAdapter(c.req.param('id'));
    if (adapter) {
      try {
        return c.json(await adapter.search(parseSearchInput(c)));
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    return c.json(
      await client().getJson(
        withQuery(
          `/api/cloud-storage/connections/${c.req.param('id')}/search`,
          c,
        ),
      ),
    );
  });

  cloudStorageRoutes.get('/connections/:id/items/:itemId', async (c) => {
    const adapter = resolveLocalAdapter(c.req.param('id'));
    if (adapter) {
      try {
        return c.json(await adapter.getMetadata(c.req.param('itemId')));
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    return c.json(
      await client().getJson(
        `/api/cloud-storage/connections/${c.req.param('id')}/items/${encodeURIComponent(
          c.req.param('itemId'),
        )}`,
      ),
    );
  });

  cloudStorageRoutes.get(
    '/connections/:id/items/:itemId/thumbnail',
    async (c) => {
      const adapter = resolveLocalAdapter(c.req.param('id'));
      if (adapter?.getThumbnail) {
        try {
          const upstream = await adapter.getThumbnail(c.req.param('itemId'));
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              'cache-control': 'private, max-age=300',
              'content-type':
                upstream.headers.get('content-type') ?? 'image/webp',
            },
          });
        } catch (error) {
          return cloudStorageErrorResponse(c, error);
        }
      }

      return c.json({ error: 'thumbnail_not_available' }, 404);
    },
  );

  cloudStorageRoutes.patch(
    '/connections/:id/items/:itemId',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      const body = c.req.valid('json');
      const adapter = resolveLocalAdapter(c.req.param('id'));
      if (adapter) {
        try {
          return c.json(
            await adapter.updateMetadata(c.req.param('itemId'), body),
          );
        } catch (error) {
          return cloudStorageErrorResponse(c, error);
        }
      }

      return c.json(
        await client().patchJson(
          `/api/cloud-storage/connections/${c.req.param('id')}/items/${encodeURIComponent(
            c.req.param('itemId'),
          )}`,
          body,
        ),
      );
    },
  );

  cloudStorageRoutes.get(
    '/connections/:id/items/:itemId/content',
    async (c) => {
      const range = c.req.header('range');
      const adapter = resolveLocalAdapter(c.req.param('id'));
      if (adapter) {
        try {
          // Fetch responses come back with immutable headers, so handing
          // the raw Response to Hono causes downstream middleware (CORS,
          // request-tracker) to throw `TypeError: immutable` when they
          // try to set headers. Wrap into a fresh Response with mutable
          // headers, same shape as the site-proxy passthrough below.
          const upstream = await adapter.download(c.req.param('itemId'), {
            range,
          });
          return passthroughContentResponse(upstream);
        } catch (error) {
          return cloudStorageErrorResponse(c, error);
        }
      }

      const headers = new Headers();
      if (range) headers.set('Range', range);
      const upstream = await client().streamGetResponse(
        withQuery(
          `/api/cloud-storage/connections/${c.req.param('id')}/items/${encodeURIComponent(
            c.req.param('itemId'),
          )}/content`,
          c,
        ),
        { headers },
      );
      return passthroughContentResponse(upstream);
    },
  );

  cloudStorageRoutes.post(
    '/connections/:id/items/:itemId/move',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      return c.json(
        await client().postJson(
          `/api/cloud-storage/connections/${c.req.param('id')}/items/${encodeURIComponent(
            c.req.param('itemId'),
          )}/move`,
          c.req.valid('json'),
        ),
      );
    },
  );

  cloudStorageRoutes.post(
    '/connections/:id/items/:itemId/copy',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      return c.json(
        await client().postJson(
          `/api/cloud-storage/connections/${c.req.param('id')}/items/${encodeURIComponent(
            c.req.param('itemId'),
          )}/copy`,
          c.req.valid('json'),
        ),
      );
    },
  );

  cloudStorageRoutes.delete('/connections/:id/items/:itemId', async (c) => {
    const adapter = resolveLocalAdapter(c.req.param('id'));
    if (adapter) {
      try {
        await adapter.delete(
          c.req.param('itemId'),
          booleanFromQuery(new URL(c.req.url).searchParams.get('permanent')),
        );
        return c.json({ ok: true });
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    return c.json(
      await client().del(
        withQuery(
          `/api/cloud-storage/connections/${c.req.param('id')}/items/${encodeURIComponent(
            c.req.param('itemId'),
          )}`,
          c,
        ),
      ),
    );
  });

  cloudStorageRoutes.get('/connections/:id/sync', async (c) => {
    return c.json(
      await client().getJson(
        `/api/cloud-storage/connections/${c.req.param('id')}/sync`,
      ),
    );
  });

  cloudStorageRoutes.post('/connections/:id/sync/run', async (c) => {
    return c.json(
      await client().postJson(
        `/api/cloud-storage/connections/${c.req.param('id')}/sync`,
        {},
      ),
    );
  });

  cloudStorageRoutes.patch('/connections/:id/assets-index', async (c) => {
    const connectionId = c.req.param('id');
    const parsedBody = await readJsonRecordBody(c);
    if (!parsedBody.ok) return c.json({ error: parsedBody.error }, 400);
    const enabled = optionalBoolean(parsedBody.body.enabled);
    if (enabled === undefined) {
      return c.json({ error: 'invalid_assets_index_setting' }, 400);
    }

    const connection = findCatalogConnection(
      connectionId,
      localPersonalMediaStore(),
    );
    const source = connection ? assetCatalogSource(connection) : null;
    if (!connection || source !== 'immich') {
      return c.json({ error: 'assets_index_not_supported' }, 404);
    }

    setAssetCatalogIndexing(source, connectionId, enabled);
    return c.json({
      item: enrichAssetCatalogConnection(connection, getAssetCatalogStatus),
    });
  });

  cloudStorageRoutes.post('/connections/:id/assets-sync', async (c) => {
    const connectionId = c.req.param('id');
    const parsedBody = await readOptionalJsonRecordBody(c);
    if (!parsedBody.ok) return c.json({ error: parsedBody.error }, 400);
    const mode = optionalAssetSyncMode(parsedBody.body.mode);
    if (parsedBody.body.mode !== undefined && !mode) {
      return c.json({ error: 'invalid_assets_sync_mode' }, 400);
    }
    const limit = optionalPositiveIntegerFromUnknown(parsedBody.body.limit);
    if (parsedBody.body.limit !== undefined && limit === undefined) {
      return c.json({ error: 'invalid_assets_sync_limit' }, 400);
    }

    const connection = findCatalogConnection(
      connectionId,
      localPersonalMediaStore(),
    );
    const source = connection ? assetCatalogSource(connection) : null;
    if (!connection || source !== 'immich') {
      return c.json({ error: 'assets_sync_not_supported' }, 404);
    }

    try {
      const result = await syncAssetCatalogConnection({
        source,
        connectionId,
        mode,
        limit,
      });
      return c.json({
        result,
        item: enrichAssetCatalogConnection(connection, getAssetCatalogStatus),
      });
    } catch (error) {
      return assetCatalogErrorResponse(c, error);
    }
  });

  cloudStorageRoutes.get('/connections/:id/changes', async (c) => {
    const adapter = resolveLocalAdapter(c.req.param('id'));
    if (adapter) {
      try {
        return c.json(await adapter.getChanges(parseChangeInput(c)));
      } catch (error) {
        return cloudStorageErrorResponse(c, error);
      }
    }

    return c.json(
      await client().getJson(
        withQuery(
          `/api/cloud-storage/connections/${c.req.param('id')}/changes`,
          c,
        ),
      ),
    );
  });

  cloudStorageRoutes.get('/connections/:id/content-jobs', async (c) => {
    return c.json(
      await client().getJson(
        withQuery(
          `/api/cloud-storage/connections/${c.req.param('id')}/content-jobs`,
          c,
        ),
      ),
    );
  });

  cloudStorageRoutes.patch(
    '/connections/:id/content-jobs/:jobId',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      return c.json(
        await client().patchJson(
          `/api/cloud-storage/connections/${c.req.param('id')}/content-jobs/${c.req.param(
            'jobId',
          )}`,
          c.req.valid('json'),
        ),
      );
    },
  );

  cloudStorageRoutes.get('/immich/published-preview', async (c) => {
    const parsed = parseImmichPhotoUrl(c.req.query('url'));
    if (!parsed) return c.json({ error: 'invalid_immich_photo_url' }, 400);

    const connection = findLocalImmichConnectionForUrl(
      localPersonalMediaStore(),
      parsed.url,
    );
    if (!connection) {
      return c.json({ error: 'immich_connection_not_found' }, 404);
    }

    const adapter = resolveLocalAdapter(connection.id);
    if (!adapter) return c.json({ error: 'immich_connection_not_found' }, 404);

    try {
      const metadata = await adapter.getMetadata(parsed.assetId);
      const mediaType = mediaTypeFromMime(metadata.mimeType);
      if (mediaType !== 'image' && mediaType !== 'video') {
        return c.json({ error: 'unsupported_immich_media_type' }, 415);
      }

      const connectionId = encodeURIComponent(connection.id);
      const assetId = encodeURIComponent(parsed.assetId);
      return c.json({
        item: {
          connectionId: connection.id,
          assetId: parsed.assetId,
          name: metadata.name,
          mimeType: metadata.mimeType,
          mediaType,
          webUrl: metadata.webUrl ?? parsed.url.toString(),
          thumbnailUrl: `/cloud-storage/connections/${connectionId}/items/${assetId}/thumbnail`,
          contentUrl: `/cloud-storage/connections/${connectionId}/items/${assetId}/content`,
        },
      });
    } catch (error) {
      return cloudStorageErrorResponse(c, error);
    }
  });

  cloudStorageRoutes.post(
    '/index',
    zValidator('json', jsonObjectSchema),
    async (c) => {
      return c.json(
        await client().postJson(
          '/api/cloud-storage/index',
          c.req.valid('json'),
        ),
      );
    },
  );

  return cloudStorageRoutes;
}

export const cloudStorageRoutes = createCloudStorageRoutes();

function mergeConnectionsResponse(
  response: ConnectionsResponse,
  localConnections: SiteConnection[],
  getAssetCatalogStatus: NonNullable<
    CloudStorageRouteDeps['getAssetCatalogStatus']
  >,
): ConnectionsResponse {
  const siteConnections = response.items ?? response.connections ?? [];
  const localIds = new Set(localConnections.map((connection) => connection.id));
  const items = [
    ...localConnections,
    ...siteConnections.filter((connection) => !localIds.has(connection.id)),
  ];
  return {
    ...response,
    items: items.map((connection) =>
      enrichAssetCatalogConnection(connection, getAssetCatalogStatus),
    ),
  };
}

function localConnectionsResponse(
  localConnections: SiteConnection[],
  getAssetCatalogStatus: NonNullable<
    CloudStorageRouteDeps['getAssetCatalogStatus']
  >,
): ConnectionsResponse {
  return {
    featureEnabled: true,
    wakeupMode: 'longpoll',
    items: localConnections.map((connection) =>
      enrichAssetCatalogConnection(connection, getAssetCatalogStatus),
    ),
  };
}

function enrichAssetCatalogConnection(
  connection: SiteConnection,
  getAssetCatalogStatus: NonNullable<
    CloudStorageRouteDeps['getAssetCatalogStatus']
  >,
): AssetCatalogSiteConnection {
  const source = assetCatalogSource(connection);
  if (!source) return connection;
  return {
    ...connection,
    assetsCatalog: getAssetCatalogStatus(source, connection.id),
  };
}

function assetCatalogSource(connection: SiteConnection): 'immich' | null {
  return connection.provider === 'immich' ? 'immich' : null;
}

function findCatalogConnection(
  connectionId: string,
  localStore: LocalPersonalMediaStore,
): SiteConnection | null {
  const local = localStore.getConnectionDetails(connectionId);
  if (local) return local;
  const cached = getCachedConnection(connectionId);
  if (!cached) return null;
  return {
    id: cached.id,
    provider: cached.provider,
    accountEmail: cached.accountEmail,
    displayName: cached.displayName,
    status: cached.status,
    capabilitiesJson: cached.capabilitiesJson,
    connectedAt: cached.connectedAt,
  };
}

function canServeLocalConnectionsOnly(error: unknown): boolean {
  return (
    isCloudStorageError(error) &&
    (error.code === 'auth_revoked' ||
      error.code === 'not_found' ||
      error.code === 'site_unreachable')
  );
}

async function maybeBuildGoogleDriveConnection(): Promise<SiteConnection | null> {
  try {
    const tokenManager = await import('@/shared/auth/token-manager');
    const tokens = await tokenManager.getTokens('google');
    if (!tokens) return null;
    const hasAllScopes = GOOGLE_DRIVE_SCOPES.every((scope) =>
      tokens.scopes.includes(scope),
    );
    if (!hasAllScopes) return null;
    return {
      id: GOOGLE_DRIVE_LOCAL_ID,
      provider: 'google_drive',
      accountEmail: null,
      displayName: 'Google Drive',
      status: 'active',
      capabilitiesJson: null,
      connectedAt: NATIVE_CLOUD_CONNECTED_AT_SENTINEL,
    } as SiteConnection;
  } catch {
    return null;
  }
}

async function maybeBuildNativeCloudConnection(
  id: string,
  provider: SiteConnection['provider'],
  displayName: string,
  tokenProvider:
    | 'google'
    | 'slack'
    | 'notion'
    | 'box'
    | 'dropbox'
    | 'onedrive'
    | 'site',
): Promise<SiteConnection | null> {
  try {
    const tokenManager = await import('@/shared/auth/token-manager');
    const connection = await tokenManager.getConnection(tokenProvider);
    if (!connection || connection.status !== 'active') return null;
    return {
      id,
      provider,
      accountEmail: connection.accountEmail || null,
      displayName: connection.displayName || displayName,
      status: 'active',
      capabilitiesJson: null,
      connectedAt: NATIVE_CLOUD_CONNECTED_AT_SENTINEL,
    } as SiteConnection;
  } catch {
    return null;
  }
}

async function listNativeCloudConnections(): Promise<SiteConnection[]> {
  const results = await Promise.all([
    maybeBuildGoogleDriveConnection(),
    maybeBuildNativeCloudConnection(BOX_LOCAL_ID, 'box', 'Box', 'box'),
    maybeBuildNativeCloudConnection(
      DROPBOX_LOCAL_ID,
      'dropbox',
      'Dropbox',
      'dropbox',
    ),
    maybeBuildNativeCloudConnection(
      ONEDRIVE_LOCAL_ID,
      'onedrive',
      'OneDrive',
      'onedrive',
    ),
  ]);
  return results.filter((c): c is SiteConnection => c !== null);
}

function nativeProviderForLocalId(
  id: string,
): 'google' | 'box' | 'dropbox' | 'onedrive' | null {
  if (id === GOOGLE_DRIVE_LOCAL_ID) return 'google';
  if (id === BOX_LOCAL_ID) return 'box';
  if (id === DROPBOX_LOCAL_ID) return 'dropbox';
  if (id === ONEDRIVE_LOCAL_ID) return 'onedrive';
  return null;
}

function defaultResolveLocalAdapter(
  connectionId: string,
): CloudStorageAdapter | null {
  if (connectionId === GOOGLE_DRIVE_LOCAL_ID) {
    return new GoogleDriveLocalAdapter();
  }
  if (connectionId === BOX_LOCAL_ID) return new BoxLocalAdapter();
  if (connectionId === DROPBOX_LOCAL_ID) return new DropboxLocalAdapter();
  if (connectionId === ONEDRIVE_LOCAL_ID) return new OneDriveLocalAdapter();
  try {
    const connection = getCachedConnection(connectionId);
    if (!connection || !PERSONAL_MEDIA_PROVIDERS.has(connection.provider)) {
      return null;
    }
    return cloudStorageRegistry.resolve(connectionId);
  } catch {
    return null;
  }
}

function defaultGetAssetCatalogStatus(
  source: 'immich',
  connectionId: string,
): AssetCatalogConnectionStatus {
  return getAssetConnectionCatalogStatus(source, connectionId);
}

function defaultSetAssetCatalogIndexing(
  _source: 'immich',
  connectionId: string,
  enabled: boolean,
): void {
  setAssetConnectionIndexingEnabled(connectionId, enabled);
}

function defaultSyncAssetCatalogConnection(input: {
  source: 'immich';
  connectionId: string;
  mode?: AssetSyncMode;
  limit?: number;
}): Promise<AssetSyncResult> {
  return syncAssetsConnection(input);
}

function defaultClearAssetCatalogConnection(
  source: 'immich',
  connectionId: string,
): void {
  clearAssetConnectionIndexing(connectionId);
  removeAssetSyncState(source, connectionId);
}

function cloudStorageErrorResponse(c: Context, error: unknown) {
  if (isCloudStorageError(error)) {
    return c.json(error.toJSON(), error.status as ContentfulStatusCode);
  }
  if (error instanceof Error && error.name === 'ConnectionRevokedError') {
    return c.json(
      { error: 'auth_revoked', message: error.message, status: 401 },
      401,
    );
  }
  throw error;
}

function assetCatalogErrorResponse(c: Context, error: unknown) {
  if (error instanceof AssetsError) {
    return c.json(
      { error: error.message },
      error.status as ContentfulStatusCode,
    );
  }
  return cloudStorageErrorResponse(c, error);
}

function parseListChildrenInput(c: { req: { url: string } }) {
  const params = new URL(c.req.url).searchParams;
  return {
    parentId: optionalNullableString(params.get('parentId')),
    cursor: optionalString(params.get('cursor')),
    limit: optionalPositiveInteger(params.get('limit')),
    includeTrashed: optionalBooleanQuery(params.get('includeTrashed')),
    mimeTypes: params.getAll('mimeType'),
  };
}

function parseSearchInput(c: { req: { url: string } }) {
  const params = new URL(c.req.url).searchParams;
  const place = stripEmpty({
    country: optionalString(params.get('country')) || undefined,
    state: optionalString(params.get('state')) || undefined,
    city: optionalString(params.get('city')) || undefined,
  });
  const camera = stripEmpty({
    make: optionalString(params.get('make')) || undefined,
    model: optionalString(params.get('model')) || undefined,
    lensModel: optionalString(params.get('lensModel')) || undefined,
  });
  const media = stripEmpty({
    takenAfter: optionalString(params.get('takenAfter')) || undefined,
    takenBefore: optionalString(params.get('takenBefore')) || undefined,
    isFavorite: optionalBooleanQuery(params.get('isFavorite')),
    isArchived: optionalBooleanQuery(params.get('isArchived')),
    isInAlbum: optionalBooleanQuery(params.get('isInAlbum')),
    personIds: params.getAll('personIds').filter(Boolean),
  });
  return {
    ...parseListChildrenInput(c),
    query: params.get('q') ?? params.get('query') ?? '',
    nameOnly: optionalBooleanQuery(params.get('nameOnly')),
    fileTypes: params.getAll('fileType'),
    mediaKind: parseMediaKind(params.get('media_kind')),
    licenseFilter: params.getAll('license_filter'),
    searchMode: parseSearchMode(params.get('searchMode')),
    place: place ? place : undefined,
    camera: camera ? camera : undefined,
    media: media ? media : undefined,
  };
}

function parseSearchMode(
  value: string | null,
): 'context' | 'filename' | 'description' | 'ocr' | undefined {
  if (
    value === 'context' ||
    value === 'filename' ||
    value === 'description' ||
    value === 'ocr'
  ) {
    return value;
  }
  return undefined;
}

function stripEmpty<T extends Record<string, unknown>>(
  input: T,
): T | undefined {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of Object.entries(input)) {
    if (
      value !== undefined &&
      !(Array.isArray(value) && value.length === 0) &&
      value !== ''
    ) {
      out[key] = value;
      any = true;
    }
  }
  return any ? (out as T) : undefined;
}

function parseChangeInput(c: { req: { url: string } }) {
  const params = new URL(c.req.url).searchParams;
  return {
    cursor: optionalString(params.get('cursor')),
    limit: optionalPositiveInteger(params.get('limit')),
    rootId: optionalNullableString(params.get('rootId')),
  };
}

function parsePathMappingBody(connectionId: string, body: unknown) {
  if (!body || typeof body !== 'object') {
    return { error: 'invalid_path_mapping' as const };
  }

  const input = body as Record<string, unknown>;
  const immichPathPrefix = parseNonEmptyString(input.immichPathPrefix);
  const localMountPath = parseNonEmptyString(input.localMountPath);
  if (!immichPathPrefix || !localMountPath) {
    return { error: 'invalid_path_mapping' as const };
  }

  return {
    input: {
      id: optionalString(input.id),
      connectionId,
      immichPathPrefix,
      localMountPath,
      verified: optionalBoolean(input.verified),
      verifiedAt: optionalString(input.verifiedAt),
      verificationHash: optionalString(input.verificationHash),
      lastError: optionalString(input.lastError),
      disabled: optionalBoolean(input.disabled),
    },
  };
}

function parseCandidatePathMapping(connectionId: string, body: unknown) {
  const parsed = parsePathMappingBody(connectionId, body);
  if (!('input' in parsed) || parsed.input === undefined) return null;

  return {
    id: parsed.input.id ?? 'candidate',
    connectionId,
    immichPathPrefix: parsed.input.immichPathPrefix,
    localMountPath: parsed.input.localMountPath,
  };
}

function parseBridgeAsset(body: unknown): ImmichBridgeAsset | null {
  if (!body || typeof body !== 'object') return null;

  const input = body as Record<string, unknown>;
  const id = parseNonEmptyString(input.id);
  const originalPath = parseNonEmptyString(input.originalPath);
  const fileSizeBytes = input.fileSizeBytes;
  if (!id || !originalPath || typeof fileSizeBytes !== 'number') {
    return null;
  }

  return {
    id,
    originalPath,
    fileSizeBytes,
    checksum: optionalString(input.checksum),
  };
}

function parseNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function parseImmichPhotoUrl(
  value: string | undefined,
): { url: URL; assetId: string } | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const photosIndex = parts.indexOf('photos');
  const assetId = photosIndex >= 0 ? parts[photosIndex + 1] : undefined;
  if (!assetId || !/^[0-9a-fA-F-]{8,80}$/.test(assetId)) return null;

  return { url, assetId };
}

function findLocalImmichConnectionForUrl(
  store: LocalPersonalMediaStore,
  assetUrl: URL,
): SiteConnection | null {
  for (const connection of store.listConnections()) {
    if (connection.provider !== 'immich') continue;
    const details = store.getConnectionDetails(connection.id);
    if (
      details?.credential.baseUrl &&
      immichBaseMatchesUrl(details.credential.baseUrl, assetUrl)
    ) {
      return connection;
    }
  }
  return null;
}

function immichBaseMatchesUrl(baseUrl: string, assetUrl: URL): boolean {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  if (base.protocol !== assetUrl.protocol || base.host !== assetUrl.host) {
    return false;
  }

  const basePath = base.pathname.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  if (!basePath) return true;

  return (
    assetUrl.pathname === basePath ||
    assetUrl.pathname.startsWith(`${basePath}/`)
  );
}

function mediaTypeFromMime(mimeType: string): 'image' | 'video' | 'file' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (typeof value !== 'string') return undefined;
  return value === '' ? null : value;
}

function optionalPositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalPositiveIntegerFromUnknown(
  value: unknown,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number') return undefined;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function optionalAssetSyncMode(value: unknown): AssetSyncMode | undefined {
  if (value === undefined) return undefined;
  if (value === 'auto' || value === 'full' || value === 'delta') return value;
  return undefined;
}

async function readJsonRecordBody(
  c: Context,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: 'invalid_json' }
> {
  try {
    const body = await c.req.json();
    return {
      ok: true,
      body:
        body && typeof body === 'object' && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {},
    };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

async function readOptionalJsonRecordBody(
  c: Context,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: 'invalid_json' }
> {
  const contentLength = c.req.header('content-length');
  const contentType = c.req.header('content-type');
  if (contentLength === '0' || (!contentLength && !contentType)) {
    return { ok: true, body: {} };
  }
  return readJsonRecordBody(c);
}

function optionalBooleanQuery(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return booleanFromQuery(value);
}

function booleanFromQuery(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function booleanFromForm(value: FormDataEntryValue | null): boolean {
  return typeof value === 'string' && booleanFromQuery(value);
}

function stringFromForm(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function metadataFromForm(
  value: FormDataEntryValue | null,
): Record<string, string> | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const metadata: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === 'string') metadata[key] = item;
  }
  return metadata;
}

function parseMediaKind(
  value: string | null,
): 'image' | 'video' | 'audio' | 'document' | undefined {
  if (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'document'
  ) {
    return value;
  }
  return undefined;
}

function sanitizeBridgeResolution(resolution: BridgeResolution) {
  if (resolution.kind === 'local') {
    return {
      kind: resolution.kind,
      sizeBytes: resolution.sizeBytes,
      mappingId: resolution.mappingId,
      checksum: resolution.checksum,
    };
  }
  return {
    kind: resolution.kind,
    reason: resolution.reason,
    mappingId: resolution.mappingId,
  };
}

function sanitizeVerificationResult(result: BridgeVerificationResult) {
  if (result.verified) {
    return {
      verified: true as const,
      verificationHash: result.verificationHash,
      resolution: sanitizeBridgeResolution(result.resolution),
    };
  }
  return {
    verified: false as const,
    reason: result.reason,
    resolution: result.resolution
      ? sanitizeBridgeResolution(result.resolution)
      : undefined,
  };
}

const CONTENT_PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
];

function passthroughContentResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of CONTENT_PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function withQuery(path: string, c: { req: { url: string } }): string {
  const query = new URL(c.req.url).search;
  return `${path}${query}`;
}
