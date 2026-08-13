import crypto from 'node:crypto';

import type Database from 'better-sqlite3';
import { LRUCache } from 'lru-cache';

import { getDatabase } from '@/shared/db';
import {
  embed,
  embedImage,
  embedImageText,
  getEmbeddingDim,
  getImageEmbeddingModelName,
  getLocalModelStatus,
  getModelName,
  type EmbedOptions,
  type EmbeddingProvider,
} from '@/shared/services/memory';
import { createLogger } from '@/shared/utils/logger';

import type { Asset } from './types';

const logger = createLogger('Assets/Embedding');
const ASSET_VECTOR_DIM = 768;
const QUERY_CACHE_MAX = 100;

export type AssetEmbeddingModality = 'text' | 'image';

export interface AssetEmbeddingConfig {
  modality: AssetEmbeddingModality;
  model: string | null;
  dim: number | null;
  reencodeStatus: 'idle' | 'running' | 'failed';
}

export interface ActiveEmbeddingConfig {
  modality: AssetEmbeddingModality;
  model: string;
  dim: number;
  provider: EmbeddingProvider;
  apiKey?: string;
}

export interface AssetEmbeddingResult {
  embedded: number;
  skipped: Array<{ modality: AssetEmbeddingModality; reason: string }>;
}

export interface AssetVectorHit {
  assetId: string;
  rank: number;
  distance: number;
  modality: AssetEmbeddingModality;
}

export interface AssetEmbeddingServiceOptions {
  db?: Database.Database;
  textEmbedder?: (
    text: string,
    config: ActiveEmbeddingConfig,
  ) => Promise<Float32Array>;
  imageEmbedder?: (
    filePath: string,
    config: ActiveEmbeddingConfig,
  ) => Promise<Float32Array>;
  imageTextEmbedder?: (
    text: string,
    config: ActiveEmbeddingConfig,
  ) => Promise<Float32Array>;
  localTextModelReady?: () => boolean;
}

interface EmbeddingConfigRow {
  modality: string;
  model: string | null;
  dim: number | null;
  reencode_status: string;
}

interface EmbeddingIdRow {
  id: number;
}

interface VectorRow {
  asset_id: string;
  distance: number;
  modality: string;
}

export class AssetEmbeddingService {
  private readonly db: Database.Database;
  private readonly textEmbedder: (
    text: string,
    config: ActiveEmbeddingConfig,
  ) => Promise<Float32Array>;
  private readonly imageEmbedder: (
    filePath: string,
    config: ActiveEmbeddingConfig,
  ) => Promise<Float32Array>;
  private readonly imageTextEmbedder: (
    text: string,
    config: ActiveEmbeddingConfig,
  ) => Promise<Float32Array>;
  private readonly localTextModelReady: () => boolean;
  private readonly queryCache = new LRUCache<string, Float32Array>({
    max: QUERY_CACHE_MAX,
  });

  constructor(options: AssetEmbeddingServiceOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.textEmbedder = options.textEmbedder ?? defaultTextEmbedder;
    this.imageEmbedder = options.imageEmbedder ?? defaultImageEmbedder;
    this.imageTextEmbedder =
      options.imageTextEmbedder ?? defaultImageTextEmbedder;
    this.localTextModelReady =
      options.localTextModelReady ??
      (() => getLocalModelStatus().state === 'ready');
  }

  embedAsset(asset: Asset, filePath?: string): Promise<AssetEmbeddingResult> {
    return this.embedAssetNow(asset, filePath);
  }

  async searchText(
    query: string,
    options: { limit: number; includeImages?: boolean },
  ): Promise<AssetVectorHit[]> {
    const lists = await Promise.all([
      this.vectorSearch(query, 'text', options.limit),
      options.includeImages
        ? this.vectorSearch(query, 'image', options.limit)
        : Promise.resolve([]),
    ]);
    return lists.flat().sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.assetId.localeCompare(b.assetId);
    });
  }

  setEmbeddingModel(
    modality: AssetEmbeddingModality,
    next: { model: string | null; dim: number | null },
  ): AssetEmbeddingConfig {
    const current = this.readConfig(modality);
    const now = Date.now();
    const changed = current.model !== next.model || current.dim !== next.dim;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO assets_embedding_config
           (modality, model, dim, updated_at, reencode_status)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(modality) DO UPDATE SET
             model = excluded.model,
             dim = excluded.dim,
             updated_at = excluded.updated_at,
             reencode_status = excluded.reencode_status`,
        )
        .run(
          modality,
          next.model,
          next.dim,
          now,
          changed ? 'running' : current.reencodeStatus,
        );
      if (changed) this.enqueueReencodeJob(modality);
    });
    tx();
    return this.readConfig(modality);
  }

  syncTextConfig(): AssetEmbeddingConfig {
    const next = this.activeTextConfig();
    return this.setEmbeddingModel('text', {
      model: next.model,
      dim: next.dim,
    });
  }

  markReencodeIdle(modality: AssetEmbeddingModality): void {
    this.db
      .prepare(
        `UPDATE assets_embedding_config
         SET reencode_status = 'idle', updated_at = ?
         WHERE modality = ?`,
      )
      .run(Date.now(), modality);
  }

  private async embedAssetNow(
    asset: Asset,
    filePath: string | undefined,
  ): Promise<AssetEmbeddingResult> {
    const result: AssetEmbeddingResult = { embedded: 0, skipped: [] };
    const text = buildAssetText(asset);
    if (text) {
      this.syncTextConfig();
      const config = this.activeTextConfig();
      const canEmbed = this.canEmbed(config);
      if (!canEmbed.ok) {
        result.skipped.push({ modality: 'text', reason: canEmbed.reason });
      } else {
        const vector = await this.textEmbedder(text, config);
        this.upsertEmbedding(
          asset.id,
          'text',
          config.model,
          config.dim,
          vector,
        );
        result.embedded += 1;
      }
    } else {
      result.skipped.push({ modality: 'text', reason: 'no_indexable_text' });
    }

    if (asset.kind === 'image' && filePath) {
      const config = this.activeImageConfig();
      if (!config) {
        result.skipped.push({
          modality: 'image',
          reason: 'image_model_disabled',
        });
      } else {
        const canEmbed = this.canEmbed(config);
        if (!canEmbed.ok) {
          result.skipped.push({ modality: 'image', reason: canEmbed.reason });
        } else {
          const vector = await this.imageEmbedder(filePath, config);
          this.upsertEmbedding(
            asset.id,
            'image',
            config.model,
            config.dim,
            vector,
          );
          result.embedded += 1;
        }
      }
    }

    return result;
  }

  private async vectorSearch(
    query: string,
    modality: AssetEmbeddingModality,
    limit: number,
  ): Promise<AssetVectorHit[]> {
    if (modality === 'text') this.syncTextConfig();
    const config =
      modality === 'text' ? this.activeTextConfig() : this.activeImageConfig();
    if (!config) return [];
    const canEmbed = this.canEmbed(config);
    if (!canEmbed.ok) return [];

    let vector: Float32Array;
    try {
      vector = await this.queryVector(query, config);
    } catch (error) {
      logger.debug(`assets query embedding skipped: ${error}`);
      return [];
    }
    if (vector.length !== ASSET_VECTOR_DIM) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT ae.asset_id, v.distance, ae.modality
           FROM assets_vec_768 v
           JOIN asset_embeddings ae ON ae.id = v.rowid
           JOIN assets a ON a.id = ae.asset_id
           WHERE v.embedding MATCH ?
             AND k = ?
             AND ae.modality = ?
             AND ae.model = ?
             AND ae.dim = ?
             AND a.deleted_at IS NULL
           ORDER BY v.distance`,
        )
        .all(
          bufferFromVector(vector),
          limit,
          modality,
          config.model,
          config.dim,
        ) as VectorRow[];
      return rows.map((row, index) => ({
        assetId: row.asset_id,
        rank: index + 1,
        distance: row.distance,
        modality: row.modality as AssetEmbeddingModality,
      }));
    } catch (error) {
      this.markVecUnavailable(error);
      return [];
    }
  }

  private async queryVector(
    query: string,
    config: ActiveEmbeddingConfig,
  ): Promise<Float32Array> {
    const cacheKey = `${config.provider}:${config.modality}:${config.model}:${config.dim}:${query}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;
    const vector =
      config.modality === 'image'
        ? await this.imageTextEmbedder(query, config)
        : await this.textEmbedder(query, config);
    this.queryCache.set(cacheKey, vector);
    return vector;
  }

  private upsertEmbedding(
    assetId: string,
    modality: AssetEmbeddingModality,
    model: string,
    dim: number,
    vector: Float32Array,
  ): void {
    if (dim !== ASSET_VECTOR_DIM || vector.length !== ASSET_VECTOR_DIM) {
      logger.debug(
        `assets ${modality} embedding skipped for ${assetId}: unsupported dim ${vector.length}`,
      );
      return;
    }

    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO asset_embeddings
           (asset_id, modality, model, dim, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(asset_id, modality, model) DO UPDATE SET
             dim = excluded.dim,
             updated_at = excluded.updated_at`,
        )
        .run(assetId, modality, model, dim, now);
      const row = this.db
        .prepare(
          `SELECT id FROM asset_embeddings
           WHERE asset_id = ? AND modality = ? AND model = ?`,
        )
        .get(assetId, modality, model) as EmbeddingIdRow | undefined;
      if (!row) throw new Error('Asset embedding row not found after upsert');
      this.db
        .prepare(`DELETE FROM assets_vec_768 WHERE rowid = ?`)
        .run(BigInt(row.id));
      this.db
        .prepare(
          `INSERT INTO assets_vec_768(rowid, embedding, modality, model)
           VALUES (?, ?, ?, ?)`,
        )
        .run(BigInt(row.id), bufferFromVector(vector), modality, model);
    });

    try {
      tx();
    } catch (error) {
      this.markVecUnavailable(error);
    }
  }

  private canEmbed(
    config: ActiveEmbeddingConfig,
  ): { ok: true } | { ok: false; reason: string } {
    if (!this.isVecAvailable())
      return { ok: false, reason: 'sqlite_vec_unavailable' };
    if (config.dim !== ASSET_VECTOR_DIM) {
      return { ok: false, reason: `unsupported_dim_${config.dim}` };
    }
    if (config.modality === 'text' && config.provider === 'local') {
      return this.localTextModelReady()
        ? { ok: true }
        : { ok: false, reason: 'local_embedding_model_not_ready' };
    }
    if (config.provider !== 'local' && !config.apiKey) {
      return { ok: false, reason: 'embedding_api_key_missing' };
    }
    return { ok: true };
  }

  private activeTextConfig(): ActiveEmbeddingConfig {
    const provider = readProvider(
      this.db,
      'assets.embedding_provider',
      'local',
    );
    const apiKey =
      readSetting(this.db, 'assets.embedding_api_key') ??
      readSetting(this.db, 'memory.embeddingApiKey') ??
      undefined;
    const modelSetting =
      readSetting(this.db, 'assets.embedding_model') ??
      readSetting(this.db, 'memory.embeddingModel') ??
      undefined;
    const model = getModelName({ provider, apiKey, model: modelSetting });
    return {
      modality: 'text',
      model,
      dim: getEmbeddingDim(provider, model),
      provider,
      apiKey,
    };
  }

  private activeImageConfig(): ActiveEmbeddingConfig | null {
    const row = this.readConfig('image');
    if (!row.model || !row.dim) return null;
    return {
      modality: 'image',
      model: getImageEmbeddingModelName(row.model),
      dim: row.dim,
      provider: 'local',
    };
  }

  private readConfig(modality: AssetEmbeddingModality): AssetEmbeddingConfig {
    const row = this.db
      .prepare(
        `SELECT modality, model, dim, reencode_status
         FROM assets_embedding_config
         WHERE modality = ?`,
      )
      .get(modality) as EmbeddingConfigRow | undefined;
    return {
      modality,
      model: row?.model ?? null,
      dim: row?.dim ?? null,
      reencodeStatus:
        row?.reencode_status === 'running' || row?.reencode_status === 'failed'
          ? row.reencode_status
          : 'idle',
    };
  }

  private isVecAvailable(): boolean {
    return readSetting(this.db, 'assets.vec_available') !== 'false';
  }

  private markVecUnavailable(error: unknown): void {
    // Only persist the permanent disable flag when the error genuinely
    // indicates the sqlite-vec extension/virtual table is missing. Transient
    // failures (locked DB, a single malformed vector) must not disable
    // semantic search for the rest of the process lifetime.
    if (!isVecExtensionMissing(error)) {
      logger.warn(`assets vector store write failed (transient): ${error}`);
      return;
    }
    logger.debug(`assets vector store unavailable: ${error}`);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES ('assets.vec_available', 'false', datetime('now'))`,
      )
      .run();
  }

  private enqueueReencodeJob(modality: AssetEmbeddingModality): void {
    this.db
      .prepare(
        `INSERT INTO asset_jobs
         (id, kind, status, payload_json, created_at, updated_at)
         VALUES (?, 'reencode', 'queued', ?, ?, ?)`,
      )
      .run(
        cryptoRandomUuid(),
        JSON.stringify({ modality }),
        Date.now(),
        Date.now(),
      );
  }
}

export function createAssetEmbeddingService(
  options: AssetEmbeddingServiceOptions = {},
): AssetEmbeddingService {
  return new AssetEmbeddingService(options);
}

function isVecExtensionMissing(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes('no such module: vec0') ||
    message.includes('no such table: assets_vec') ||
    message.includes('vec0 constructor')
  );
}

function defaultTextEmbedder(
  text: string,
  config: ActiveEmbeddingConfig,
): Promise<Float32Array> {
  return embed(text, embedOptions(config));
}

function defaultImageEmbedder(
  filePath: string,
  config: ActiveEmbeddingConfig,
): Promise<Float32Array> {
  return embedImage(filePath, config.model);
}

function defaultImageTextEmbedder(
  text: string,
  config: ActiveEmbeddingConfig,
): Promise<Float32Array> {
  return embedImageText(text, config.model);
}

function embedOptions(config: ActiveEmbeddingConfig): EmbedOptions {
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
  };
}

function buildAssetText(asset: Asset): string {
  return [
    asset.title,
    asset.description,
    asset.caption,
    asset.ocrText,
    asset.transcript,
    asset.tags.length ? `tags: ${asset.tags.join(', ')}` : null,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n')
    .slice(0, 8_192);
}

function bufferFromVector(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function readProvider(
  db: Database.Database,
  key: string,
  fallback: EmbeddingProvider,
): EmbeddingProvider {
  const raw = readSetting(db, key);
  return raw === 'openai' || raw === 'gemini' || raw === 'local'
    ? raw
    : fallback;
}

function readSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function cryptoRandomUuid(): string {
  return crypto.randomUUID();
}
