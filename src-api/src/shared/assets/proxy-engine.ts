import fs from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import { probeFile, runFFmpeg } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import {
  assetDerivativeDir,
  resolveAssetDerivativeSource,
} from './derivative-source';
import type { ProxyPreset } from './materializer-types';
import { AssetRegistry, AssetsError } from './registry';
import type { Asset } from './types';
import { getAssetsWorkspaceRoot } from './workspace';

const logger = createLogger('Assets/Proxy');

export interface GenerateAssetProxyInput {
  assetId: string;
  contentHash: string;
  preset: ProxyPreset;
  signal?: AbortSignal;
}

export interface GenerateAssetProxyResult {
  generated: boolean;
  skippedReason?: 'already-ready' | 'unsupported-kind' | 'below-threshold';
  path?: string;
  bytes?: number;
}

interface AssetProxyEngineOptions {
  db?: Database.Database;
  registry?: AssetRegistry;
  getWorkspaceRoot?: () => string;
  now?: () => number;
  renderer?: AssetProxyRenderer;
}

export type AssetProxyRenderer = (input: {
  asset: Asset;
  preset: ProxyPreset;
  sourcePath: string;
  outputPath: string;
  signal?: AbortSignal;
}) => Promise<{ width?: number; height?: number; durationMs?: number }>;

export class AssetProxyEngine {
  private readonly db: Database.Database;
  private readonly registry: AssetRegistry;
  private readonly getWorkspaceRoot: () => string;
  private readonly now: () => number;
  private readonly renderer: AssetProxyRenderer;

  constructor(options: AssetProxyEngineOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.getWorkspaceRoot = options.getWorkspaceRoot ?? getAssetsWorkspaceRoot;
    this.registry =
      options.registry ??
      new AssetRegistry({
        db: this.db,
        getWorkspaceRoot: this.getWorkspaceRoot,
      });
    this.now = options.now ?? Date.now;
    this.renderer = options.renderer ?? renderProxy;
  }

  async generate(
    input: GenerateAssetProxyInput,
  ): Promise<GenerateAssetProxyResult> {
    const existing = await this.existingProxy(input);
    if (existing) {
      this.touchProxy(input.contentHash, input.preset);
      return { generated: false, skippedReason: 'already-ready', ...existing };
    }

    const source = await resolveAssetDerivativeSource({
      db: this.db,
      registry: this.registry,
      assetId: input.assetId,
      contentHash: input.contentHash,
      workspaceRoot: this.getWorkspaceRoot(),
    });
    const unsupported = unsupportedReason(source.asset, input.preset);
    if (unsupported) return { generated: false, skippedReason: unsupported };

    const outputPath = proxyPathFor(
      this.getWorkspaceRoot(),
      input.contentHash,
      input.preset,
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const metadata = await this.renderer({
      asset: source.asset,
      preset: input.preset,
      sourcePath: source.sourcePath,
      outputPath,
      signal: input.signal,
    });
    const stat = await fs.stat(outputPath);
    const now = this.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO asset_proxies (
          content_hash, preset, proxy_path, bytes, width, height, duration_ms,
          generated_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.contentHash,
        input.preset,
        outputPath,
        stat.size,
        metadata.width ?? null,
        metadata.height ?? null,
        metadata.durationMs ?? null,
        now,
        now,
      );
    logger.info('assets.proxy.generated', {
      asset_id: input.assetId,
      preset: input.preset,
      bytes: stat.size,
    });
    return { generated: true, path: outputPath, bytes: stat.size };
  }

  private async existingProxy(input: GenerateAssetProxyInput): Promise<{
    path: string;
    bytes: number;
  } | null> {
    const row = this.db
      .prepare(
        `SELECT proxy_path, bytes
         FROM asset_proxies
         WHERE content_hash = ? AND preset = ?`,
      )
      .get(input.contentHash, input.preset) as
      | { proxy_path: string; bytes: number }
      | undefined;
    if (!row) return null;
    const stat = await fs.stat(row.proxy_path).catch(() => null);
    if (stat?.isFile()) return { path: row.proxy_path, bytes: row.bytes };
    this.db
      .prepare(
        'DELETE FROM asset_proxies WHERE content_hash = ? AND preset = ?',
      )
      .run(input.contentHash, input.preset);
    return null;
  }

  private touchProxy(contentHash: string, preset: ProxyPreset): void {
    this.db
      .prepare(
        `UPDATE asset_proxies
         SET last_used_at = ?
         WHERE content_hash = ? AND preset = ?`,
      )
      .run(this.now(), contentHash, preset);
  }
}

function proxyPathFor(
  workspaceRoot: string,
  contentHash: string,
  preset: ProxyPreset,
): string {
  const ext =
    preset === 'edit_1080p'
      ? '.webm'
      : preset === 'design_2k'
        ? '.webp'
        : preset === 'audio_mp3'
          ? '.mp3'
          : '.mp4';
  return path.join(
    assetDerivativeDir(workspaceRoot, 'proxies', contentHash),
    `${preset}${ext}`,
  );
}

function unsupportedReason(
  asset: Asset,
  preset: ProxyPreset,
): GenerateAssetProxyResult['skippedReason'] | null {
  if (preset === 'design_2k') {
    if (asset.kind !== 'image') return 'unsupported-kind';
    return null;
  }
  if (preset === 'audio_mp3') {
    if (asset.kind !== 'audio') return 'unsupported-kind';
    return asset.mime === 'audio/mpeg' ? 'below-threshold' : null;
  }
  if (preset === 'web_720p')
    return asset.kind === 'video' ? null : 'unsupported-kind';
  return asset.kind === 'video' ? null : 'unsupported-kind';
}

async function renderProxy(input: {
  asset: Asset;
  preset: ProxyPreset;
  sourcePath: string;
  outputPath: string;
  signal?: AbortSignal;
}): Promise<{ width?: number; height?: number; durationMs?: number }> {
  if (input.preset === 'design_2k') return renderDesignProxy(input);
  const args = proxyFfmpegArgs(
    input.preset,
    input.sourcePath,
    input.outputPath,
  );
  const result = await runFFmpeg(args, {
    inputDuration: (input.asset.durationMs ?? 0) / 1000 || undefined,
    abortSignal: input.signal,
  });
  if (result.exitCode !== 0) {
    throw new AssetsError('Asset proxy generation failed', 502, {
      stderr: result.stderr.slice(0, 500),
      preset: input.preset,
    });
  }
  const probe = await probeFile(
    input.outputPath,
    path.dirname(input.outputPath),
  );
  const video = probe.streams.find((stream) => stream.codecType === 'video');
  return {
    width: video?.width,
    height: video?.height,
    durationMs: probe.duration ? Math.round(probe.duration * 1000) : undefined,
  };
}

async function renderDesignProxy(input: {
  sourcePath: string;
  outputPath: string;
}): Promise<{ width?: number; height?: number }> {
  const sharp = (await import('sharp')).default;
  const info = await sharp(input.sourcePath, { failOn: 'none' })
    .rotate()
    .resize({ width: 2048, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(input.outputPath);
  return { width: info.width, height: info.height };
}

function proxyFfmpegArgs(
  preset: ProxyPreset,
  sourcePath: string,
  outputPath: string,
): string[] {
  if (preset === 'audio_mp3') {
    return [
      '-i',
      sourcePath,
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      outputPath,
    ];
  }
  if (preset === 'web_720p') {
    return [
      '-i',
      sourcePath,
      '-vf',
      'scale=1280:-2:force_original_aspect_ratio=decrease',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ];
  }
  if (preset !== 'edit_1080p')
    throw new AssetsError('Unsupported proxy preset', 400);
  return [
    '-i',
    sourcePath,
    '-vf',
    'scale=1920:-2:force_original_aspect_ratio=decrease',
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '23',
    '-b:v',
    '0',
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    outputPath,
  ];
}
