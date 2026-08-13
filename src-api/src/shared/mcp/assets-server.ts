/**
 * Asset Catalog MCP Server
 *
 * Exposes the workspace asset catalog to agent sessions. The server delegates
 * search and writes to the catalog services so REST, UI, and MCP behavior stay
 * on the same storage/indexing path.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  ASSET_KINDS,
  ASSET_SOURCES,
  getAssetRegistry,
  getAssetSearch,
  assetUrls,
  getAssetMaterializeStatus,
  renderAssetAttributionBlock,
  syncAssetsSource,
  type Asset,
  type AssetKind,
  type AssetMetadataHint,
  type AssetSearchHit,
} from '@/shared/assets';
import { getSetting, setSetting } from '@/shared/db/operations';
import { attachCatalogAssetToDesign } from '@/shared/services/design-mode/catalog-assets';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';
import { attachCatalogAssetToProject } from '@/shared/video/catalog-assets';

const logger = createLogger('AssetsMCP');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_SESSION_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_PROJECT_BUDGET_BYTES = 20 * 1024 * 1024 * 1024;
const SESSION_BUDGET_KEY = 'assets.materialize_session_budget_bytes';
const PROJECT_BUDGET_KEY = 'assets.materialize_project_budget_bytes';
const budgetIncreaseRequests = new Set<string>();

const assetKindSchema = z.enum(ASSET_KINDS);
const assetSourceSchema = z.enum(ASSET_SOURCES);
const attachmentScopeInputSchema = z
  .object({
    scope: z.string().min(1).describe('Attachment scope, e.g. video_project'),
    scope_id: z.string().min(1).describe('Attachment scope identifier'),
  })
  .strict();

const assetSearchInputSchema = z
  .object({
    query: z
      .string()
      .max(2000)
      .optional()
      .describe('Keyword or natural-language search query'),
    semantic: z
      .boolean()
      .optional()
      .describe('Use semantic vector search when available'),
    modalities: z
      .array(assetKindSchema)
      .max(ASSET_KINDS.length)
      .optional()
      .describe('Restrict search to asset kinds'),
    sources: z
      .array(assetSourceSchema)
      .max(ASSET_SOURCES.length)
      .optional()
      .describe('Restrict search to catalog sources'),
    tags: z.array(z.string().min(1)).max(100).optional(),
    collection_id: z.string().min(1).optional(),
    attached_to: attachmentScopeInputSchema.optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const assetGetInputSchema = z
  .object({
    asset_id: z.string().min(1),
  })
  .strict();

const assetSimilarInputSchema = z
  .object({
    asset_id: z.string().min(1),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  })
  .strict();

const assetHintInputSchema = z
  .object({
    kind: assetKindSchema.optional(),
    mime: z.string().min(1).optional(),
    bytes: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    caption: z.string().optional(),
    ocr_text: z.string().optional(),
    transcript: z.string().optional(),
    captured_at: z.union([z.string().datetime(), z.number().int()]).optional(),
    provenance: z.record(z.string(), z.unknown()).optional(),
    exif: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();

const assetIngestInputSchema = z
  .object({
    source: assetSourceSchema.optional().default('local_fs'),
    connection_id: z.string().nullable().optional(),
    source_id: z.string().nullable().optional(),
    client_request_id: z.string().nullable().optional(),
    path: z
      .string()
      .min(1)
      .optional()
      .describe('Workspace-relative or workspace-contained absolute file path'),
    url: z
      .string()
      .url()
      .optional()
      .describe('Reserved for remote ingestion; currently not materialized'),
    hint: assetHintInputSchema.optional(),
  })
  .strict()
  .refine((value) => value.path || value.url, {
    message: 'Provide path or url',
  });

const assetAttachInputSchema = z
  .object({
    asset_id: z.string().min(1),
    scope: z.string().min(1),
    scope_id: z.string().min(1),
    role: z.string().nullable().optional(),
    session_id: z.string().min(1).optional(),
    client_request_id: z.string().min(1).optional(),
  })
  .strict();

const assetTagInputSchema = z
  .object({
    asset_id: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();

const assetSyncInputSchema = z
  .object({
    source: z
      .enum(['immich', 'box', 'google_drive', 'dropbox', 'onedrive'])
      .optional()
      .default('immich'),
    connection_id: z.string().min(1).optional(),
    mode: z.enum(['auto', 'full', 'delta']).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

const assetRecentInputSchema = z
  .object({
    scope: z.string().min(1).optional(),
    scope_id: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  })
  .strict();

const assetMaterializeStatusInputSchema = z
  .object({
    asset_id: z.string().min(1),
    scope: z.string().min(1).optional(),
    scope_id: z.string().min(1).optional(),
  })
  .strict();

const assetAttributionInputSchema = z
  .object({
    scope: z.string().min(1),
    scope_id: z.string().min(1),
    format: z.enum(['text', 'markdown', 'html']).optional(),
  })
  .strict();

const assetBudgetIncreaseInputSchema = z
  .object({
    budget: z
      .enum(['session', 'project'])
      .describe(
        'Budget to increase: session downloads or stored project assets',
      ),
    requested_bytes: z
      .number()
      .int()
      .positive()
      .describe(
        'Minimum byte limit needed for the next attach/materialize call',
      ),
    reason: z
      .string()
      .min(8)
      .max(1000)
      .describe('Why the larger materialization budget is needed'),
    session_id: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
    scope_id: z.string().min(1).optional(),
  })
  .strict();

export type AssetsSearchInput = z.infer<typeof assetSearchInputSchema>;
export type AssetsGetInput = z.infer<typeof assetGetInputSchema>;
export type AssetsSimilarInput = z.infer<typeof assetSimilarInputSchema>;
export type AssetsIngestInput = z.infer<typeof assetIngestInputSchema>;
export type AssetsAttachInput = z.infer<typeof assetAttachInputSchema>;
export type AssetsTagInput = z.infer<typeof assetTagInputSchema>;
export type AssetsSyncInput = z.infer<typeof assetSyncInputSchema>;
export type AssetsRecentInput = z.infer<typeof assetRecentInputSchema>;
export type AssetsMaterializeStatusInput = z.infer<
  typeof assetMaterializeStatusInputSchema
>;
export type AssetsAttributionInput = z.infer<
  typeof assetAttributionInputSchema
>;
export type AssetsBudgetIncreaseInput = z.infer<
  typeof assetBudgetIncreaseInputSchema
>;

interface AssetRecord {
  id: string;
  source: string;
  connection_id: string | null;
  source_id: string | null;
  client_request_id: string | null;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  content_hash: string | null;
  perceptual_hash: string | null;
  title: string | null;
  description: string | null;
  caption: string | null;
  ocr_text: string | null;
  transcript: string | null;
  storage_path: string | null;
  thumb_path: string | null;
  preview_path: string | null;
  captured_at: number | null;
  imported_at: number;
  modified_at: number;
  deleted_at: number | null;
  provenance: unknown | null;
  exif: unknown | null;
  gps_lat: number | null;
  gps_lng: number | null;
  index_state: string;
  index_error: string | null;
  tags: string[];
  attachments: Array<{
    scope: string;
    scope_id: string;
    role: string | null;
    attached_at: number;
  }>;
}

interface AssetSearchRecord {
  id: string;
  source: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  title: string | null;
  storage_path: string | null;
  thumb_path: string | null;
  preview_path: string | null;
  captured_at: number | null;
  imported_at: number;
  tags: string[];
  attachments: Array<{
    scope: string;
    scope_id: string;
    role: string | null;
    attached_at: number;
  }>;
  score: number;
  score_breakdown: {
    fts: number;
    vector?: number;
  };
  snippet: string | null;
  urls: {
    raw: string;
    preview: string;
    proxy?: Partial<Record<string, string>>;
  };
}

export async function searchAssets(input: AssetsSearchInput): Promise<{
  items: AssetSearchRecord[];
  next_cursor: string | null;
}> {
  const page = await getAssetSearch().search({
    text: input.query,
    semantic: input.semantic,
    modalities: input.modalities,
    sources: input.sources,
    tags: input.tags,
    collectionId: input.collection_id,
    attachedTo: input.attached_to
      ? {
          scope: input.attached_to.scope,
          scopeId: input.attached_to.scope_id,
        }
      : undefined,
    dateRange: dateRangeFromInput(input),
    limit: clampLimit(input.limit),
    cursor: input.cursor,
  });

  return {
    items: page.items.map(searchHitToRecord),
    next_cursor: page.nextCursor,
  };
}

export async function getAsset(input: AssetsGetInput): Promise<AssetRecord> {
  const asset = getAssetRegistry().get(input.asset_id);
  if (!asset) throw new Error('Asset not found');
  return assetToRecord(asset);
}

export async function findSimilarAssets(input: AssetsSimilarInput): Promise<{
  items: AssetSearchRecord[];
  next_cursor: string | null;
}> {
  const registry = getAssetRegistry();
  const asset = registry.get(input.asset_id);
  if (!asset) throw new Error('Asset not found');

  const limit = clampLimit(input.limit);
  const query = [
    asset.title,
    asset.description,
    asset.caption,
    asset.tags.length ? asset.tags.join(' ') : null,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ');

  if (!query) {
    const page = registry.list({
      modalities: [asset.kind],
      limit: limit + 1,
    });
    return {
      items: page.items
        .filter((item) => item.id !== asset.id)
        .slice(0, limit)
        .map((item) =>
          searchHitToRecord({
            asset: item,
            score: 1,
            scoreBreakdown: { fts: 0 },
            snippet: null,
          }),
        ),
      next_cursor: page.nextCursor,
    };
  }

  const page = await getAssetSearch().search({
    text: query,
    semantic: true,
    modalities: [asset.kind],
    limit: limit + 1,
  });
  return {
    items: page.items
      .filter((hit) => hit.asset.id !== asset.id)
      .slice(0, limit)
      .map(searchHitToRecord),
    next_cursor: page.nextCursor,
  };
}

export async function ingestAsset(input: AssetsIngestInput): Promise<{
  created: boolean;
  asset: AssetRecord;
}> {
  if (!input.path) {
    if (input.url) {
      throw new Error(
        'URL ingestion is not available yet. Download the file into the workspace and pass path.',
      );
    }
    throw new Error('path is required for local catalog ingestion');
  }

  const result = await getAssetRegistry().ingest({
    source: input.source,
    connectionId: input.connection_id ?? null,
    sourceId: input.source_id ?? null,
    clientRequestId: input.client_request_id ?? null,
    storagePath: input.path,
    hint: input.hint ? hintFromInput(input.hint) : undefined,
  });

  return {
    created: result.created,
    asset: assetToRecord(result.asset),
  };
}

export async function attachAsset(input: AssetsAttachInput): Promise<{
  asset: AssetRecord;
  media_item_id?: string;
  design_output_id?: string;
  materialization_id?: string;
  license?: unknown;
  urls?: unknown;
}> {
  if (input.scope === 'video_project') {
    // Agent attaches stay eager for now — downstream tools immediately
    // expect a local file (transcode / analyze / proxy). Switching the
    // agent path to reference + on-demand hydration is a follow-up
    // (every read-bytes tool needs a `ensureHydrated` preamble first).
    const result = await attachCatalogAssetToProject(
      input.scope_id,
      input.asset_id,
      {
        role: input.role ?? undefined,
        sessionId: input.session_id,
        clientRequestId: input.client_request_id,
        hydrate: 'proxy',
      },
    );
    const attached = getAssetRegistry().get(input.asset_id);
    if (!attached) throw new Error('Asset not found after attach');
    return {
      asset: assetToRecord(attached),
      media_item_id: result.asset.id,
      materialization_id: result.materialization?.materializationId,
      license: result.materialization?.license,
      urls: result.materialization?.urls,
    };
  }

  if (input.scope === 'design_project') {
    const result = await attachCatalogAssetToDesign(
      input.scope_id,
      input.asset_id,
      {
        role: input.role === 'inline' ? 'inline' : 'reference',
        sessionId: input.session_id,
        clientRequestId: input.client_request_id,
      },
    );
    const attached = getAssetRegistry().get(input.asset_id);
    if (!attached) throw new Error('Asset not found after attach');
    return {
      asset: assetToRecord(attached),
      design_output_id: result.asset.id,
      materialization_id: result.materialization.materializationId,
      license: result.materialization.license,
      urls: result.materialization.urls,
    };
  }

  const registry = getAssetRegistry();
  registry.attach(
    input.asset_id,
    { scope: input.scope, scopeId: input.scope_id },
    input.role ?? undefined,
  );
  const asset = registry.get(input.asset_id);
  if (!asset) throw new Error('Asset not found after attach');
  return { asset: assetToRecord(asset) };
}

export async function tagAsset(input: AssetsTagInput): Promise<{
  asset: AssetRecord;
}> {
  const registry = getAssetRegistry();
  registry.tag(input.asset_id, input.tags);
  const asset = registry.get(input.asset_id);
  if (!asset) throw new Error('Asset not found after tag');
  return { asset: assetToRecord(asset) };
}

export async function syncAssets(input: AssetsSyncInput) {
  return syncAssetsSource({
    source: input.source,
    connectionId: input.connection_id,
    mode: input.mode,
    limit: input.limit,
  });
}

export async function recentAssets(input: AssetsRecentInput) {
  const registry = getAssetRegistry();
  const limit = clampLimit(input.limit);
  const workspace = registry.list({ limit });
  const project =
    input.scope && input.scope_id
      ? registry.list({
          attachedTo: { scope: input.scope, scopeId: input.scope_id },
          limit,
        })
      : { items: [], nextCursor: null };
  return {
    workspace_recent: workspace.items.map((asset) => ({
      ...assetToRecord(asset),
      urls: assetUrls(asset.id),
    })),
    project_recent: project.items.map((asset) => ({
      ...assetToRecord(asset),
      urls: assetUrls(asset.id),
    })),
  };
}

export async function materializeStatus(input: AssetsMaterializeStatusInput) {
  return getAssetMaterializeStatus({
    assetId: input.asset_id,
    scope: input.scope,
    scopeId: input.scope_id,
  });
}

export async function assetAttribution(input: AssetsAttributionInput) {
  return {
    attribution: renderAssetAttributionBlock({
      scope: input.scope,
      scopeId: input.scope_id,
      format: input.format ?? 'text',
    }),
  };
}

export async function requestBudgetIncrease(input: AssetsBudgetIncreaseInput) {
  const key =
    input.budget === 'session' ? SESSION_BUDGET_KEY : PROJECT_BUDGET_KEY;
  const previousBytes = readBudgetSetting(
    key,
    input.budget === 'session'
      ? DEFAULT_SESSION_BUDGET_BYTES
      : DEFAULT_PROJECT_BUDGET_BYTES,
  );
  const requestedBytes = Math.max(input.requested_bytes, previousBytes);
  const changed = requestedBytes > previousBytes;
  if (changed && input.session_id) {
    const requestKey = `${input.session_id}:${input.budget}`;
    if (budgetIncreaseRequests.has(requestKey)) {
      throw new Error(
        `Budget increase already requested for this ${input.budget} budget in this session`,
      );
    }
    budgetIncreaseRequests.add(requestKey);
  }
  if (changed) setSetting(key, String(requestedBytes));
  logger.info('assets.budget_increase.requested', {
    budget: input.budget,
    key,
    previousBytes,
    requestedBytes,
    changed,
    sessionId: input.session_id,
    scope: input.scope,
    scopeId: input.scope_id,
  });
  return {
    budget: input.budget,
    key,
    previous_bytes: previousBytes,
    new_bytes: requestedBytes,
    changed,
    reason: input.reason,
  };
}

export const assetsTools = [
  tool(
    'assets_search',
    'Search the workspace asset catalog with hybrid keyword and semantic search. Use tags/modalities for exact catalog filters, and semantic=true for descriptive visual or text queries.',
    {
      query: assetSearchInputSchema.shape.query,
      semantic: assetSearchInputSchema.shape.semantic,
      modalities: assetSearchInputSchema.shape.modalities,
      sources: assetSearchInputSchema.shape.sources,
      tags: assetSearchInputSchema.shape.tags,
      collection_id: assetSearchInputSchema.shape.collection_id,
      attached_to: assetSearchInputSchema.shape.attached_to,
      date_from: assetSearchInputSchema.shape.date_from,
      date_to: assetSearchInputSchema.shape.date_to,
      limit: assetSearchInputSchema.shape.limit,
      cursor: assetSearchInputSchema.shape.cursor,
    },
    async (input) => executeJson('assets_search', () => searchAssets(input)),
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_get',
    'Get a full asset catalog record by id.',
    {
      asset_id: assetGetInputSchema.shape.asset_id,
    },
    async (input) => executeJson('assets_get', () => getAsset(input)),
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_similar',
    'Find assets similar to a known catalog asset using its title, description, caption, tags, and available embeddings.',
    {
      asset_id: assetSimilarInputSchema.shape.asset_id,
      limit: assetSimilarInputSchema.shape.limit,
    },
    async (input) =>
      executeJson('assets_similar', () => findSimilarAssets(input)),
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_ingest',
    'Register a workspace file in the asset catalog. Idempotent on client_request_id, source/source_id, or the catalog service dedupe path.',
    {
      source: assetIngestInputSchema.shape.source,
      connection_id: assetIngestInputSchema.shape.connection_id,
      source_id: assetIngestInputSchema.shape.source_id,
      client_request_id: assetIngestInputSchema.shape.client_request_id,
      path: assetIngestInputSchema.shape.path,
      url: assetIngestInputSchema.shape.url,
      hint: assetIngestInputSchema.shape.hint,
    },
    async (input) => executeJson('assets_ingest', () => ingestAsset(input)),
    {
      annotations: {
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_attach',
    'Attach an asset to a workspace scope such as a video_project, task, message, or chat_session.',
    {
      asset_id: assetAttachInputSchema.shape.asset_id,
      scope: assetAttachInputSchema.shape.scope,
      scope_id: assetAttachInputSchema.shape.scope_id,
      role: assetAttachInputSchema.shape.role,
      session_id: assetAttachInputSchema.shape.session_id,
      client_request_id: assetAttachInputSchema.shape.client_request_id,
    },
    async (input) => executeJson('assets_attach', () => attachAsset(input)),
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_tag',
    'Add one or more tags to an asset.',
    {
      asset_id: assetTagInputSchema.shape.asset_id,
      tags: assetTagInputSchema.shape.tags,
    },
    async (input) => executeJson('assets_tag', () => tagAsset(input)),
    {
      annotations: {
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_sync',
    'Sync an enabled external asset source into the catalog. For Immich, use connection_id to sync one server or omit it to sync all Immich connectors with "Index in Assets" enabled.',
    {
      source: assetSyncInputSchema.shape.source,
      connection_id: assetSyncInputSchema.shape.connection_id,
      mode: assetSyncInputSchema.shape.mode,
      limit: assetSyncInputSchema.shape.limit,
    },
    async (input) => executeJson('assets_sync', () => syncAssets(input)),
    {
      annotations: {
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
  ),
  tool(
    'assets_recent',
    'Return recent workspace and project assets with preview/raw URLs.',
    {
      scope: assetRecentInputSchema.shape.scope,
      scope_id: assetRecentInputSchema.shape.scope_id,
      limit: assetRecentInputSchema.shape.limit,
    },
    async (input) => executeJson('assets_recent', () => recentAssets(input)),
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_materialize_status',
    'Read materialization, proxy, and preview-artifact status for an asset.',
    {
      asset_id: assetMaterializeStatusInputSchema.shape.asset_id,
      scope: assetMaterializeStatusInputSchema.shape.scope,
      scope_id: assetMaterializeStatusInputSchema.shape.scope_id,
    },
    async (input) =>
      executeJson('assets_materialize_status', () => materializeStatus(input)),
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_attribution',
    'Render attribution credits for all materialized assets in a scope.',
    {
      scope: assetAttributionInputSchema.shape.scope,
      scope_id: assetAttributionInputSchema.shape.scope_id,
      format: assetAttributionInputSchema.shape.format,
    },
    async (input) =>
      executeJson('assets_attribution', () => assetAttribution(input)),
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'assets_request_budget_increase',
    'Ask the user to approve raising a session or project asset-download quota when attach/materialize is blocked. Include the blocked operation reason and the required byte limit; retry only after approval.',
    {
      budget: assetBudgetIncreaseInputSchema.shape.budget,
      requested_bytes: assetBudgetIncreaseInputSchema.shape.requested_bytes,
      reason: assetBudgetIncreaseInputSchema.shape.reason,
      session_id: assetBudgetIncreaseInputSchema.shape.session_id,
      scope: assetBudgetIncreaseInputSchema.shape.scope,
      scope_id: assetBudgetIncreaseInputSchema.shape.scope_id,
    },
    async (input) =>
      executeJson('assets_request_budget_increase', () =>
        requestBudgetIncrease(input),
      ),
    {
      annotations: {
        title: 'Approve asset download budget increase',
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  ),
];

export const ASSETS_TOOL_NAMES = assetsTools.map((t) => t.name);

export function createAssetsMcpServer() {
  return createSdkMcpServer({
    name: 'assets',
    version: '0.1.0',
    tools: assetsTools,
  });
}

async function executeJson<T>(
  toolName: string,
  operation: () => Promise<T>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}> {
  try {
    return jsonResult(await operation());
  } catch (error) {
    const message = errorMessage(error);
    logger.warn(`${toolName} failed: ${message}`);
    return errorResult(message);
  }
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

function dateRangeFromInput(input: AssetsSearchInput) {
  const fromMs = parseDateMs(input.date_from);
  const toMs = parseDateMs(input.date_to);
  return fromMs === undefined && toMs === undefined
    ? undefined
    : { fromMs, toMs };
}

function parseDateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid datetime: ${value}`);
  return parsed;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function readBudgetSetting(key: string, fallback: number): number {
  const raw = getSetting(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function hintFromInput(
  hint: NonNullable<AssetsIngestInput['hint']>,
): Partial<AssetMetadataHint> {
  return {
    kind: hint.kind,
    mime: hint.mime,
    bytes: hint.bytes,
    width: hint.width,
    height: hint.height,
    durationMs: hint.duration_ms,
    title: hint.title,
    description: hint.description,
    caption: hint.caption,
    ocrText: hint.ocr_text,
    transcript: hint.transcript,
    capturedAt:
      typeof hint.captured_at === 'string'
        ? parseDateMs(hint.captured_at)
        : hint.captured_at,
    provenance: hint.provenance,
    exif: hint.exif,
    tags: hint.tags,
  };
}

function searchHitToRecord(hit: AssetSearchHit): AssetSearchRecord {
  const asset = hit.asset;
  return {
    id: asset.id,
    source: asset.source,
    kind: asset.kind,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    duration_ms: asset.durationMs,
    title: asset.title,
    storage_path: asset.storagePath,
    thumb_path: asset.thumbPath,
    preview_path: asset.previewPath,
    captured_at: asset.capturedAt,
    imported_at: asset.importedAt,
    tags: asset.tags,
    attachments: asset.attachments.map((attachment) => ({
      scope: attachment.scope,
      scope_id: attachment.scopeId,
      role: attachment.role,
      attached_at: attachment.attachedAt,
    })),
    score: hit.score,
    score_breakdown: hit.scoreBreakdown,
    snippet: hit.snippet,
    urls: assetUrls(asset.id),
  };
}

function assetToRecord(asset: Asset): AssetRecord {
  return {
    id: asset.id,
    source: asset.source,
    connection_id: asset.connectionId,
    source_id: asset.sourceId,
    client_request_id: asset.clientRequestId,
    kind: asset.kind,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    duration_ms: asset.durationMs,
    content_hash: asset.contentHash,
    perceptual_hash: asset.perceptualHash,
    title: asset.title,
    description: asset.description,
    caption: asset.caption,
    ocr_text: asset.ocrText,
    transcript: asset.transcript,
    storage_path: asset.storagePath,
    thumb_path: asset.thumbPath,
    preview_path: asset.previewPath,
    captured_at: asset.capturedAt,
    imported_at: asset.importedAt,
    modified_at: asset.modifiedAt,
    deleted_at: asset.deletedAt,
    provenance: asset.provenance,
    exif: asset.exif,
    gps_lat: asset.gpsLat,
    gps_lng: asset.gpsLng,
    index_state: asset.indexState,
    index_error: asset.indexError,
    tags: asset.tags,
    attachments: asset.attachments.map((attachment) => ({
      scope: attachment.scope,
      scope_id: attachment.scopeId,
      role: attachment.role,
      attached_at: attachment.attachedAt,
    })),
  };
}
