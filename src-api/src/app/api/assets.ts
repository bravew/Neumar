import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  ASSET_KINDS,
  ASSET_SOURCES,
  AssetRegistry,
  AssetSearchService,
  AssetsError,
  DEFAULT_ASSET_GC_RETENTION_MS,
  PROXY_PRESETS,
  assetUrls,
  getAssetMaterializeStatus,
  renderAssetAttributionBlock,
  runAssetGarbageCollection,
  subscribeAssetMaterializeEvents,
  type AssetKind,
  type AssetQuery,
  type AssetSource,
  type IngestInput,
  type PreviewArtifactKind,
  type ProxyPreset,
} from '@/shared/assets';
import { openNativeFolderDialog } from '@/shared/assets/native-folder-dialog';
import {
  getAssetsWorkspaceRoot,
  safeUploadFileName,
} from '@/shared/assets/workspace';
import { getSetting } from '@/shared/db/operations';
import {
  cloudStorageRegistry,
  resolveNativeLocalAdapter,
} from '@/shared/integrations/cloud-storage';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AssetsAPI');
const DEFAULT_SOURCE: AssetSource = 'local_fs';
const DEFAULT_ASSET_STORAGE_BUDGET_BYTES = 10 * 1024 * 1024 * 1024;
const ASSET_MULTIPART_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const STORAGE_WARNING_RATIO = 0.8;
const DAY_MS = 24 * 60 * 60 * 1000;
const REMOTE_CONTENT_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
] as const;

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

interface AssetsRouteOptions {
  registry?: AssetRegistry;
  search?: AssetSearchService;
  getWorkspaceRoot?: () => string;
}

const IngestJsonSchema = z.object({
  source: z.enum(ASSET_SOURCES).default(DEFAULT_SOURCE),
  connection_id: z.string().optional(),
  connectionId: z.string().optional(),
  source_id: z.string().optional(),
  sourceId: z.string().optional(),
  client_request_id: z.string().optional(),
  clientRequestId: z.string().optional(),
  path: z.string().optional(),
  storage_path: z.string().optional(),
  storagePath: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  hint: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      caption: z.string().optional(),
      ocrText: z.string().optional(),
      transcript: z.string().optional(),
      kind: z.enum(ASSET_KINDS).optional(),
      mime: z.string().optional(),
      bytes: z.number().int().nonnegative().optional(),
      capturedAt: z.number().int().nonnegative().optional(),
      provenance: z.unknown().optional(),
      exif: z.unknown().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export function createAssetsRoutes(options: AssetsRouteOptions = {}) {
  let registry = options.registry;
  let search = options.search;
  const getWorkspaceRoot = options.getWorkspaceRoot ?? getAssetsWorkspaceRoot;
  const assets = new Hono();
  const getRegistry = () => {
    registry ??= new AssetRegistry({ getWorkspaceRoot });
    return registry;
  };
  const getSearch = () => {
    search ??= new AssetSearchService({ registry: getRegistry() });
    return search;
  };

  assets.get('/', (c) => {
    try {
      return c.json(getRegistry().list(parseAssetQuery(c.req.query())));
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to list assets');
    }
  });

  assets.get('/search', async (c) => {
    try {
      const page = await getSearch().search(parseAssetQuery(c.req.query()));
      return c.json({
        ...page,
        items: page.items.map((item) => ({
          ...item,
          score_breakdown: item.scoreBreakdown,
          urls: assetUrls(item.asset.id),
        })),
      });
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to search assets');
    }
  });

  assets.get('/stats/storage', (c) => {
    try {
      const stats = getRegistry().storageStats();
      const budgetBytes = getStorageBudgetBytes();
      const warningThresholdBytes = Math.floor(
        budgetBytes * STORAGE_WARNING_RATIO,
      );
      return c.json({
        ...stats,
        budgetBytes,
        warningThresholdBytes,
        warning: budgetBytes > 0 && stats.localBytes >= warningThresholdBytes,
      });
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to get asset storage stats');
    }
  });

  assets.get('/events', (c) => {
    const sessionId = c.req.query('session_id');
    return streamSSE(c, async (stream) => {
      const unsubscribe = subscribeAssetMaterializeEvents((event) => {
        if (sessionId && event.sessionId !== sessionId) return;
        void stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      });
      try {
        await stream.writeSSE({
          event: 'connected',
          data: JSON.stringify({ type: 'connected' }),
        });
        while (!stream.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 15_000));
          await stream.writeSSE({ event: 'heartbeat', data: '{}' });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  assets.post('/gc', async (c) => {
    try {
      const body = await optionalJson(c.req.raw);
      const retentionDays = numberField(body, 'retentionDays');
      const limit = numberField(body, 'limit');
      const result = await runAssetGarbageCollection({
        registry: getRegistry(),
        sweepMaterializedAssets:
          options.registry === undefined &&
          options.getWorkspaceRoot === undefined,
        retentionMs:
          retentionDays === undefined
            ? DEFAULT_ASSET_GC_RETENTION_MS
            : Math.max(0, retentionDays) * DAY_MS,
        limit,
      });
      return c.json({ result });
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to run asset GC');
    }
  });

  // Spawns the OS-native folder picker on the machine running the API server
  // (dev server or Tauri sidecar) and returns the chosen absolute path. This
  // gives the web build a real folder dialog instead of a raw-path prompt; the
  // Tauri webview keeps using its own plugin-dialog and never hits this route.
  assets.post('/native-folder-dialog', async (c) => {
    try {
      const result = await openNativeFolderDialog();
      if (!result.supported) {
        return c.json(
          { error: 'No native folder dialog is available on this platform' },
          501,
        );
      }
      return c.json({ path: result.path });
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to open folder dialog');
    }
  });

  assets.get('/attribution/:scope/:scopeId', (c) => {
    try {
      return c.json({
        attribution: renderAssetAttributionBlock({
          scope: c.req.param('scope'),
          scopeId: c.req.param('scopeId'),
          format: attributionFormat(c.req.query('format')),
        }),
      });
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to get asset attribution');
    }
  });

  assets.get('/:id/materialize-status', (c) => {
    try {
      return c.json(
        getAssetMaterializeStatus({
          assetId: c.req.param('id'),
          scope: c.req.query('scope'),
          scopeId: c.req.query('scope_id') ?? c.req.query('scopeId'),
        }),
      );
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to get materialize status');
    }
  });

  assets.get('/:id', (c) => {
    try {
      const asset = getRegistry().get(c.req.param('id'));
      if (!asset) {
        return c.json(
          { error: 'Asset not found' },
          404 as ContentfulStatusCode,
        );
      }
      return c.json({ asset });
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to get asset');
    }
  });

  assets.post('/', async (c) => {
    try {
      const input = await parseIngestRequest(c.req.raw, getWorkspaceRoot);
      const result = await getRegistry().ingest(input);
      return c.json(
        result,
        (result.created ? 201 : 200) as ContentfulStatusCode,
      );
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to ingest asset');
    }
  });

  assets.delete('/:id', (c) => {
    try {
      getRegistry().softDelete(c.req.param('id'));
      return c.json({ ok: true });
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to delete asset');
    }
  });

  assets.get('/:id/raw', async (c) => {
    const id = c.req.param('id');
    try {
      const { absolutePath, mime } = getRegistry().storagePathFor(id);
      return streamResolvedFile(c, absolutePath, mime);
    } catch (error) {
      // Fall back to streaming straight from the upstream cloud connector
      // when the asset hasn't been materialized locally. Without this a
      // Drive/Box/Immich .md / .txt asset can't be opened via `/raw` and
      // the preview dialog falls through to "Inline preview is not
      // available". Mirrors the thumbnail-proxy fallback used by the
      // frontend's `resolveAssetThumbUrl`.
      if (
        error instanceof AssetsError &&
        error.status === 404 &&
        error.message === 'Asset is not materialized locally'
      ) {
        const proxied = await proxyRemoteAssetContent(
          getRegistry(),
          id,
          c.req.header('Range'),
        );
        if (proxied) return proxied;
      }
      return handleAssetsError(c, error, 'Failed to stream asset');
    }
  });

  assets.get('/:id/thumb', async (c) => {
    const id = c.req.param('id');
    try {
      const { absolutePath, mime } = getRegistry().derivativePathFor(
        id,
        'thumb',
      );
      return streamResolvedFile(c, absolutePath, mime);
    } catch (error) {
      if (error instanceof AssetsError && error.status === 404) {
        const proxied = await proxyRemoteAssetThumbnail(getRegistry(), id);
        if (proxied) return proxied;
      }
      return handleAssetsError(c, error, 'Failed to stream asset thumbnail');
    }
  });

  assets.get('/:id/preview', async (c) => {
    try {
      const id = c.req.param('id');
      const asset = getRegistry().get(id);
      if (!asset) {
        return c.json(
          { error: 'Asset not found' },
          404 as ContentfulStatusCode,
        );
      }
      const target = asset.previewPath
        ? getRegistry().derivativePathFor(id, 'preview')
        : getRegistry().storagePathFor(id);
      return streamResolvedFile(c, target.absolutePath, target.mime);
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to stream asset');
    }
  });

  assets.get('/:id/proxy/:preset', async (c) => {
    try {
      const preset = parseProxyPreset(c.req.param('preset'));
      const target = getRegistry().proxyPathFor(c.req.param('id'), preset);
      return streamResolvedFile(c, target.absolutePath, target.mime);
    } catch (error) {
      return handleAssetsError(c, error, 'Failed to stream asset proxy');
    }
  });

  assets.get('/:id/filmstrip', async (c) => {
    return streamPreviewArtifact(c, getRegistry(), 'filmstrip');
  });

  assets.get('/:id/waveform', async (c) => {
    return streamPreviewArtifact(c, getRegistry(), 'waveform');
  });

  assets.get('/:id/poster', async (c) => {
    return streamPreviewArtifact(c, getRegistry(), 'poster');
  });

  return assets;
}

export const assetsRoutes = createAssetsRoutes();

async function optionalJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return {};
  }
  const body = await request.json().catch(() => ({}));
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

function numberField(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function getStorageBudgetBytes(): number {
  const configured = Number(getSetting('assets.storage_budget_bytes'));
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_ASSET_STORAGE_BUDGET_BYTES;
}

async function parseIngestRequest(
  request: Request,
  getWorkspaceRoot: () => string,
): Promise<IngestInput> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return parseMultipartIngest(request, getWorkspaceRoot);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AssetsError('Invalid JSON body', 400);
  }
  const parsed = IngestJsonSchema.safeParse(body);
  if (!parsed.success) {
    throw new AssetsError(
      parsed.error.issues[0]?.message ?? 'Invalid body',
      400,
    );
  }
  const storagePath =
    parsed.data.storagePath ?? parsed.data.storage_path ?? parsed.data.path;
  return {
    source: parsed.data.source,
    connectionId: parsed.data.connectionId ?? parsed.data.connection_id ?? null,
    sourceId: parsed.data.sourceId ?? parsed.data.source_id ?? null,
    clientRequestId:
      parsed.data.clientRequestId ?? parsed.data.client_request_id ?? null,
    storagePath,
    hint: {
      ...parsed.data.hint,
      title: parsed.data.hint?.title ?? parsed.data.title,
      description: parsed.data.hint?.description ?? parsed.data.description,
      tags: parsed.data.hint?.tags ?? parsed.data.tags,
    },
  };
}

async function parseMultipartIngest(
  request: Request,
  getWorkspaceRoot: () => string,
): Promise<IngestInput> {
  const form = await request.formData();
  const source =
    parseSource(stringFromForm(form.get('source'))) ?? DEFAULT_SOURCE;
  const file = form.get('file');
  const pathField =
    stringFromForm(form.get('storagePath')) ??
    stringFromForm(form.get('storage_path')) ??
    stringFromForm(form.get('path'));
  const tags = stringListFromForm(form.get('tags'));

  if (isUploadedFile(file)) {
    if (file.size > ASSET_MULTIPART_UPLOAD_MAX_BYTES) {
      throw new AssetsError('Asset upload exceeds 10 MB limit', 413);
    }
    const uploadId = randomUUID();
    const fileName = safeUploadFileName(file.name);
    const relativePath = `.assets/uploads/${uploadId}/${fileName}`;
    const absoluteDir = path.join(
      getWorkspaceRoot(),
      '.assets',
      'uploads',
      uploadId,
    );
    const absolutePath = path.join(absoluteDir, fileName);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.mkdir(absoluteDir, { recursive: true });
    await fs.writeFile(absolutePath, bytes);
    return {
      source,
      connectionId: stringFromForm(form.get('connection_id')),
      sourceId: stringFromForm(form.get('source_id')),
      clientRequestId: stringFromForm(form.get('client_request_id')),
      storagePath: relativePath,
      hint: {
        title: stringFromForm(form.get('title')) ?? file.name,
        description: stringFromForm(form.get('description')) ?? undefined,
        mime: file.type || undefined,
        bytes: bytes.byteLength,
        tags,
      },
    };
  }

  if (!pathField) {
    throw new AssetsError('Provide multipart file or path', 400);
  }

  return {
    source,
    connectionId: stringFromForm(form.get('connection_id')),
    sourceId: stringFromForm(form.get('source_id')),
    clientRequestId: stringFromForm(form.get('client_request_id')),
    storagePath: pathField,
    hint: {
      title: stringFromForm(form.get('title')) ?? undefined,
      description: stringFromForm(form.get('description')) ?? undefined,
      tags,
    },
  };
}

function parseAssetQuery(query: Record<string, string>): AssetQuery {
  const limit = numberFromString(query.limit);
  const kinds = parseKinds(query.kind ?? query.modalities);
  const sources = parseSources(query.source ?? query.sources);
  return {
    text: query.q ?? query.query ?? query.text,
    semantic: booleanFromString(query.semantic),
    modalities: kinds.length ? kinds : undefined,
    sources: sources.length ? sources : undefined,
    tags: commaList(query.tag ?? query.tags),
    collectionId: query.collection_id ?? query.collectionId,
    cursor: query.cursor,
    limit,
    dateRange:
      query.from || query.to
        ? {
            fromMs: dateMs(query.from),
            toMs: dateMs(query.to),
          }
        : undefined,
  };
}

function parseKinds(value: string | undefined): AssetKind[] {
  return commaList(value).filter((item): item is AssetKind =>
    ASSET_KINDS.includes(item as AssetKind),
  );
}

function parseSources(value: string | undefined): AssetSource[] {
  return commaList(value).filter((item): item is AssetSource =>
    ASSET_SOURCES.includes(item as AssetSource),
  );
}

function parseSource(value: string | undefined): AssetSource | null {
  return value && ASSET_SOURCES.includes(value as AssetSource)
    ? (value as AssetSource)
    : null;
}

function commaList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringListFromForm(value: FormDataEntryValue | null): string[] {
  const raw = stringFromForm(value);
  return commaList(raw);
}

function stringFromForm(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFromString(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanFromString(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

function attributionFormat(value: string | undefined) {
  if (value === 'markdown' || value === 'html' || value === 'text') {
    return value;
  }
  return 'text';
}

function parseProxyPreset(value: string): ProxyPreset {
  if (PROXY_PRESETS.includes(value as ProxyPreset)) {
    return value as ProxyPreset;
  }
  throw new AssetsError('Unsupported asset proxy preset', 400);
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'size' in value &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size)
  );
}

function streamFile(
  filePath: string,
  stat: { size: number; mtime: Date; mtimeMs: number },
  mime: string,
  rangeHeader: string | undefined,
): Response {
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new Response('Invalid Range header', { status: 416 });
    }
    const start = Number.parseInt(match[1]!, 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}` },
      });
    }
    return new Response(
      toWebStream(createReadStream(filePath, { start, end })),
      {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Type': mime,
        },
      },
    );
  }

  const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
  return new Response(toWebStream(createReadStream(filePath)), {
    headers: {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, must-revalidate',
      'Content-Length': String(stat.size),
      'Content-Type': mime,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
    },
  });
}

async function proxyRemoteAssetContent(
  registry: AssetRegistry,
  assetId: string,
  range?: string,
): Promise<Response | null> {
  const asset = registry.get(assetId);
  if (!asset || !asset.connectionId || !asset.sourceId) return null;
  let adapter;
  try {
    adapter =
      resolveNativeLocalAdapter(asset.connectionId) ??
      cloudStorageRegistry.resolve(asset.connectionId);
  } catch {
    return null;
  }
  if (!adapter) return null;
  try {
    const upstream = await adapter.download(asset.sourceId, { range });
    // Preserve the upstream content-type when the provider gave us one,
    // otherwise fall back to the catalog row's recorded MIME so things
    // like `text/markdown` still trigger the inline preview branch.
    const headers = new Headers();
    for (const name of REMOTE_CONTENT_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (!headers.has('content-type')) headers.set('content-type', asset.mime);
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return null;
  }
}

async function proxyRemoteAssetThumbnail(
  registry: AssetRegistry,
  assetId: string,
): Promise<Response | null> {
  const asset = registry.get(assetId);
  if (!asset || !asset.connectionId || !asset.sourceId) return null;
  let adapter;
  try {
    adapter =
      resolveNativeLocalAdapter(asset.connectionId) ??
      cloudStorageRegistry.resolve(asset.connectionId);
  } catch {
    return null;
  }
  if (!adapter?.getThumbnail) return null;
  try {
    const upstream = await adapter.getThumbnail(asset.sourceId);
    if (!upstream.ok) return null;
    const headers = new Headers();
    headers.set('cache-control', 'private, max-age=300');
    headers.set(
      'content-type',
      upstream.headers.get('content-type') ?? 'image/webp',
    );
    const length = upstream.headers.get('content-length');
    if (length) headers.set('content-length', length);
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return null;
  }
}

async function streamResolvedFile(
  c: Context,
  absolutePath: string,
  mime: string,
): Promise<Response> {
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    return c.json(
      { error: 'Asset file not found' },
      404 as ContentfulStatusCode,
    );
  }
  return streamFile(absolutePath, stat, mime, c.req.header('Range'));
}

async function streamPreviewArtifact(
  c: Context,
  registry: AssetRegistry,
  kind: PreviewArtifactKind,
): Promise<Response> {
  try {
    const assetId = c.req.param('id');
    if (!assetId) throw new AssetsError('Asset not found', 404);
    const target = registry.previewArtifactPathFor(assetId, kind);
    return streamResolvedFile(c, target.absolutePath, target.mime);
  } catch (error) {
    return handleAssetsError(
      c,
      error,
      'Failed to stream asset preview artifact',
    );
  }
}

function toWebStream(
  nodeStream: ReturnType<typeof createReadStream>,
): ReadableStream<Buffer> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

function handleAssetsError(
  c: Context,
  error: unknown,
  fallback: string,
): Response {
  if (error instanceof AssetsError) {
    return c.json(
      { error: error.message },
      error.status as ContentfulStatusCode,
    );
  }
  logger.error(fallback, error);
  return c.json({ error: fallback }, 500 as ContentfulStatusCode);
}
