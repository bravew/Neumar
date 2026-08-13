import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import {
  CloudStorageError,
  cloudStorageRegistry,
  resolveNativeLocalAdapter,
  type CloudStorageAdapter,
} from '@/shared/integrations/cloud-storage';

import { searchImmichSourceScoped } from '../connectors/remote-search';
import { AssetEmbeddingService } from '../embedding';
import { AssetRegistry, getAssetRegistry } from '../registry';
import type {
  Asset,
  AssetQuery,
  AssetSearchHit,
  AssetSource,
  Page,
} from '../types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const FTS_CANDIDATE_LIMIT = 200;
const MAX_REMOTE_VALIDATION_PASSES = 5;
const REMOTE_ASSET_VALIDATION_TIMEOUT_MS = 750;
const RRF_K = 60;
const REMOTE_VALIDATION_TIMEOUT = Symbol('remote-validation-timeout');
type SqlValue = string | number | null;

interface SearchOptions {
  db?: Database.Database;
  embedding?: AssetEmbeddingService;
  registry?: AssetRegistry;
  remoteSearch?: (
    input: AssetQuery,
    options: { db: Database.Database; registry: AssetRegistry },
  ) => Promise<Page<AssetSearchHit> | null>;
  resolveAdapter?: (
    source: AssetSource,
    connectionId: string,
  ) => CloudStorageAdapter | null;
  remoteValidationTimeoutMs?: number;
}

interface FtsRow {
  asset_id: string;
  rank: number;
}

interface RankedCandidate {
  id: string;
  rank: number;
  source: 'fts' | 'vector';
  snippet?: string;
}

interface FusedCandidate {
  id: string;
  score: number;
  scoreBreakdown: {
    fts: number;
    vector?: number;
  };
  snippet?: string;
  bestRank: number;
}

export class AssetSearchService {
  private readonly db: Database.Database;
  private readonly embedding: AssetEmbeddingService;
  private readonly registry: AssetRegistry;
  private readonly remoteSearch: NonNullable<SearchOptions['remoteSearch']>;
  private readonly resolveAdapter: NonNullable<SearchOptions['resolveAdapter']>;
  private readonly remoteValidationTimeoutMs: number;
  // Background remote-staleness validation for the most recent blank-browse
  // page. Exposed via whenRemoteValidationSettled() so tests (and any caller
  // that needs the soft-deletes applied) can await it without blocking the
  // catalog's first paint.
  private pendingRemoteValidation: Promise<void> | null = null;

  constructor(options: SearchOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.embedding =
      options.embedding ?? new AssetEmbeddingService({ db: this.db });
    this.registry = options.registry ?? new AssetRegistry({ db: this.db });
    this.remoteSearch = options.remoteSearch ?? searchImmichSourceScoped;
    this.resolveAdapter = options.resolveAdapter ?? defaultResolveAdapter;
    this.remoteValidationTimeoutMs =
      options.remoteValidationTimeoutMs ?? REMOTE_ASSET_VALIDATION_TIMEOUT_MS;
  }

  async search(input: AssetQuery = {}): Promise<Page<AssetSearchHit>> {
    const query = input.text?.trim() ?? '';
    if (!query) {
      // Blank catalog browsing should be backed by the indexed catalog. Live
      // connector search remains useful for text queries, but the picker must
      // not block first paint on provider latency.
      return await this.listValidatedLocalPage(input);
    }

    const remotePage = await this.remoteSearch(input, {
      db: this.db,
      registry: this.registry,
    });
    if (remotePage) return remotePage;

    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery && input.semantic === false) {
      return { items: [], nextCursor: null };
    }

    const [ftsCandidates, vectorCandidates] = await Promise.all([
      Promise.resolve(
        ftsQuery ? this.ftsCandidates(ftsQuery, query, input) : [],
      ),
      input.semantic === false
        ? Promise.resolve([])
        : this.vectorCandidates(query, input),
    ]);
    const fused = fuseRankings([ftsCandidates, vectorCandidates]);
    const offset = decodeCursor(input.cursor);
    const limit = clampLimit(input.limit);
    const pageItems = fused.slice(offset, offset + limit);
    const maxScore = fused.reduce(
      (max, item) => (item.score > max ? item.score : max),
      0.0001,
    );

    return {
      items: pageItems.map((item) => {
        const asset = this.registry.get(item.id);
        if (!asset) throw new Error('Asset unexpectedly missing after search');
        return {
          asset,
          score: Math.min(item.score / maxScore, 1),
          scoreBreakdown: {
            fts: item.scoreBreakdown.fts / maxScore,
            vector:
              item.scoreBreakdown.vector === undefined
                ? undefined
                : item.scoreBreakdown.vector / maxScore,
          },
          snippet: item.snippet ?? snippetFor(asset, query),
        };
      }),
      nextCursor:
        offset + limit < fused.length ? encodeCursor(offset + limit) : null,
    };
  }

  private ftsCandidates(
    ftsQuery: string,
    query: string,
    input: AssetQuery,
  ): RankedCandidate[] {
    const filter = buildAssetFilterSql(input, 'a');
    const rows = this.db
      .prepare(
        `SELECT assets_fts.asset_id, bm25(assets_fts) AS rank
         FROM assets_fts
         JOIN assets a ON a.id = assets_fts.asset_id
         WHERE assets_fts MATCH ?
           AND ${filter.whereSql}
         ORDER BY rank ASC
         LIMIT ?`,
      )
      .all(ftsQuery, ...filter.params, FTS_CANDIDATE_LIMIT) as FtsRow[];

    return rows
      .map((row, index) => ({
        row,
        rank: index + 1,
        asset: this.registry.get(row.asset_id),
      }))
      .filter((item) => item.asset && matchesFilters(item.asset, input))
      .map((item) => {
        const asset = item.asset;
        if (!asset) throw new Error('Asset unexpectedly missing after filter');
        return {
          id: item.row.asset_id,
          rank: item.rank,
          source: 'fts' as const,
          snippet: snippetFor(asset, query) ?? undefined,
        };
      });
  }

  private async vectorCandidates(
    query: string,
    input: AssetQuery,
  ): Promise<RankedCandidate[]> {
    const includeImages =
      !input.modalities?.length || input.modalities.includes('image');
    const rows = await this.embedding.searchText(query, {
      limit: FTS_CANDIDATE_LIMIT,
      includeImages,
    });
    return rows
      .map((row) => ({
        row,
        asset: this.registry.get(row.assetId),
      }))
      .filter((item) => item.asset && matchesFilters(item.asset, input))
      .map((item, index) => ({
        id: item.row.assetId,
        rank: index + 1,
        source: 'vector' as const,
      }));
  }

  /** Resolves once any in-flight background remote validation has settled. */
  async whenRemoteValidationSettled(): Promise<void> {
    await this.pendingRemoteValidation;
  }

  private async listValidatedLocalPage(
    input: AssetQuery,
  ): Promise<Page<AssetSearchHit>> {
    const query = {
      ...input,
      limit: input.limit ?? DEFAULT_LIMIT,
    };
    const page = this.registry.list(query);
    // Return the indexed page immediately — the catalog picker must not block
    // first paint on provider latency. Remote staleness (assets deleted on the
    // provider) is reconciled in the background, so soft-deletes land on the
    // next load instead of stalling this one behind live getMetadata calls.
    //
    // Only the first page schedules a sweep: paging through the catalog must not
    // re-spawn a validation pass per page (each pass fans out one getMetadata
    // call per remote asset). Later pages reconcile on the next blank browse.
    if (!input.cursor) this.scheduleRemoteValidation(query, page.items);
    return localHits(page.items, page.nextCursor);
  }

  private scheduleRemoteValidation(query: AssetQuery, assets: Asset[]): void {
    // Coalesce: keep at most one validation sweep in flight. Rapid re-opens and
    // filter changes otherwise stack concurrent sweeps over the same remote
    // connection; a skipped sweep reconciles on the next browse.
    if (this.pendingRemoteValidation) return;
    if (!assets.some(shouldValidateRemoteAsset)) return;
    const task = (async () => {
      let current = assets;
      for (let pass = 0; pass < MAX_REMOTE_VALIDATION_PASSES; pass += 1) {
        const validated = await this.filterInaccessibleRemoteAssets(current);
        if (!validated.deletedAny) return;
        current = this.registry.list(query).items;
      }
    })().catch(() => {
      // Best-effort cleanup — a flaky provider must never reject the page that
      // already returned to the caller.
    });
    this.pendingRemoteValidation = task;
    void task.finally(() => {
      if (this.pendingRemoteValidation === task) {
        this.pendingRemoteValidation = null;
      }
    });
  }

  private async filterInaccessibleRemoteAssets(
    assets: Asset[],
  ): Promise<{ assets: Asset[]; deletedAny: boolean }> {
    const checked = await Promise.all(
      assets.map(async (asset) => {
        if (!shouldValidateRemoteAsset(asset)) {
          return { asset, keep: true, deleted: false };
        }
        try {
          const adapter = this.resolveAdapter(asset.source, asset.connectionId);
          if (!adapter) return { asset, keep: true, deleted: false };
          const metadata = await withValidationTimeout(
            adapter.getMetadata(asset.sourceId),
            this.remoteValidationTimeoutMs,
          );
          if (metadata === REMOTE_VALIDATION_TIMEOUT) {
            return { asset, keep: true, deleted: false };
          }
          return { asset, keep: true, deleted: false };
        } catch (error) {
          if (!shouldDeleteInaccessibleRemoteAsset(asset, error)) {
            return { asset, keep: true, deleted: false };
          }
          this.registry.softDeleteRemote(
            asset.source,
            asset.connectionId,
            asset.sourceId,
          );
          return { asset, keep: false, deleted: true };
        }
      }),
    );

    return {
      assets: checked.filter((item) => item.keep).map((item) => item.asset),
      deletedAny: checked.some((item) => item.deleted),
    };
  }
}

let assetSearchSingleton: AssetSearchService | null = null;

export function getAssetSearch(): AssetSearchService {
  assetSearchSingleton ??= new AssetSearchService({
    registry: getAssetRegistry(),
  });
  return assetSearchSingleton;
}

function localHits(
  assets: Asset[],
  nextCursor: string | null,
): Page<AssetSearchHit> {
  return {
    items: assets.map((asset) => ({
      asset,
      score: 1,
      scoreBreakdown: { fts: 0 },
      snippet: null,
    })),
    nextCursor,
  };
}

function shouldValidateRemoteAsset(
  asset: Asset,
): asset is Asset & { connectionId: string; sourceId: string } {
  return (
    asset.source === 'immich' &&
    Boolean(asset.connectionId) &&
    Boolean(asset.sourceId)
  );
}

function shouldDeleteInaccessibleRemoteAsset(
  asset: Asset,
  error: unknown,
): boolean {
  if (asset.source !== 'immich' || !(error instanceof CloudStorageError)) {
    return false;
  }
  return (
    error.code === 'not_found' ||
    error.code === 'permission_denied' ||
    error.status === 400 ||
    error.status === 403 ||
    error.status === 404
  );
}

function defaultResolveAdapter(
  _source: AssetSource,
  connectionId: string,
): CloudStorageAdapter | null {
  const native = resolveNativeLocalAdapter(connectionId);
  if (native) return native;
  try {
    return cloudStorageRegistry.resolve(connectionId);
  } catch {
    return null;
  }
}

async function withValidationTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof REMOTE_VALIDATION_TIMEOUT> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof REMOTE_VALIDATION_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(REMOTE_VALIDATION_TIMEOUT), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildAssetFilterSql(
  input: AssetQuery,
  alias: string,
): { whereSql: string; params: SqlValue[] } {
  const clauses = [`${alias}.deleted_at IS NULL`];
  const params: SqlValue[] = [];

  if (input.modalities?.length) {
    clauses.push(`${alias}.kind IN (${placeholders(input.modalities.length)})`);
    params.push(...input.modalities);
  }
  if (input.sources?.length) {
    clauses.push(`${alias}.source IN (${placeholders(input.sources.length)})`);
    params.push(...input.sources);
  }
  if (input.dateRange?.fromMs !== undefined) {
    clauses.push(`COALESCE(${alias}.captured_at, ${alias}.imported_at) >= ?`);
    params.push(input.dateRange.fromMs);
  }
  if (input.dateRange?.toMs !== undefined) {
    clauses.push(`COALESCE(${alias}.captured_at, ${alias}.imported_at) <= ?`);
    params.push(input.dateRange.toMs);
  }
  if (input.collectionId) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM asset_collection_items aci
        WHERE aci.asset_id = ${alias}.id AND aci.collection_id = ?
      )`,
    );
    params.push(input.collectionId);
  }
  if (input.attachedTo) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM asset_attachments aa
        WHERE aa.asset_id = ${alias}.id AND aa.scope = ? AND aa.scope_id = ?
      )`,
    );
    params.push(input.attachedTo.scope, input.attachedTo.scopeId);
  }
  for (const tag of normalizeTags(input.tags ?? [])) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM asset_tags at
        WHERE at.asset_id = ${alias}.id AND at.tag = ?
      )`,
    );
    params.push(tag);
  }

  return { whereSql: clauses.join(' AND '), params };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

function normalizeTags(tags: string[]): string[] {
  return tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

function matchesFilters(
  asset: NonNullable<ReturnType<AssetRegistry['get']>>,
  input: AssetQuery,
): boolean {
  if (input.modalities?.length && !input.modalities.includes(asset.kind)) {
    return false;
  }
  if (input.sources?.length && !input.sources.includes(asset.source)) {
    return false;
  }
  for (const tag of input.tags ?? []) {
    if (!asset.tags.includes(tag.trim().toLowerCase())) return false;
  }
  if (input.dateRange?.fromMs !== undefined) {
    const value = asset.capturedAt ?? asset.importedAt;
    if (value < input.dateRange.fromMs) return false;
  }
  if (input.dateRange?.toMs !== undefined) {
    const value = asset.capturedAt ?? asset.importedAt;
    if (value > input.dateRange.toMs) return false;
  }
  if (input.attachedTo) {
    const attached = asset.attachments.some(
      (attachment) =>
        attachment.scope === input.attachedTo?.scope &&
        attachment.scopeId === input.attachedTo.scopeId,
    );
    if (!attached) return false;
  }
  return true;
}

function toFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu)
    ?.map((token) => token.replace(/"/g, ''))
    .filter(Boolean);
  return tokens?.map((token) => `"${token}"`).join(' AND ') ?? '';
}

function fuseRankings(lists: RankedCandidate[][]): FusedCandidate[] {
  const merged = new Map<string, FusedCandidate>();
  for (const list of lists) {
    for (const item of list) {
      const contribution = 1 / (RRF_K + item.rank);
      const existing = merged.get(item.id);
      if (!existing) {
        merged.set(item.id, {
          id: item.id,
          score: contribution,
          scoreBreakdown:
            item.source === 'fts'
              ? { fts: contribution }
              : { fts: 0, vector: contribution },
          snippet: item.snippet,
          bestRank: item.rank,
        });
        continue;
      }
      existing.score += contribution;
      existing.bestRank = Math.min(existing.bestRank, item.rank);
      if (item.source === 'fts') {
        existing.scoreBreakdown.fts += contribution;
        existing.snippet = item.snippet ?? existing.snippet;
      } else {
        existing.scoreBreakdown.vector =
          (existing.scoreBreakdown.vector ?? 0) + contribution;
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.bestRank - b.bestRank;
  });
}

function snippetFor(
  asset: {
    title: string | null;
    description: string | null;
    caption: string | null;
    ocrText: string | null;
    transcript: string | null;
  },
  query: string,
): string | null {
  const haystack = [
    asset.title,
    asset.description,
    asset.caption,
    asset.ocrText,
    asset.transcript,
  ]
    .filter(Boolean)
    .join(' ');
  if (!haystack) return null;
  const firstToken = query.split(/\s+/)[0]?.toLowerCase();
  if (!firstToken) return haystack.slice(0, 160);
  const index = haystack.toLowerCase().indexOf(firstToken);
  if (index < 0) return haystack.slice(0, 160);
  const start = Math.max(0, index - 48);
  return haystack.slice(start, start + 160);
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      offset?: unknown;
    };
    return typeof parsed.offset === 'number' && parsed.offset > 0
      ? Math.trunc(parsed.offset)
      : 0;
  } catch {
    return 0;
  }
}
