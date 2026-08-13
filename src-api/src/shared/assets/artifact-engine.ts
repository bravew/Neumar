import fs from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import { runFFmpeg } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import {
  assetDerivativeDir,
  relativeWorkspacePath,
  resolveAssetDerivativeSource,
} from './derivative-source';
import type { PreviewArtifactKind } from './materializer-types';
import { AssetRegistry, AssetsError } from './registry';
import type { Asset } from './types';
import { getAssetsWorkspaceRoot } from './workspace';

const logger = createLogger('Assets/Artifact');
const FILMSTRIP_FRAME_COUNT = 10;
const WAVEFORM_BINS = 1_000;

export interface GenerateAssetArtifactInput {
  assetId: string;
  contentHash: string;
  kind: PreviewArtifactKind;
  signal?: AbortSignal;
}

export interface GenerateAssetArtifactResult {
  generated: boolean;
  skippedReason?: 'already-ready' | 'unsupported-kind';
  path?: string;
  bytes?: number;
}

interface AssetArtifactEngineOptions {
  db?: Database.Database;
  registry?: AssetRegistry;
  getWorkspaceRoot?: () => string;
  now?: () => number;
  renderer?: AssetArtifactRenderer;
}

export type AssetArtifactRenderer = (input: {
  asset: Asset;
  kind: PreviewArtifactKind;
  sourcePath: string;
  outputPath: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}) => Promise<void>;

export class AssetArtifactEngine {
  private readonly db: Database.Database;
  private readonly registry: AssetRegistry;
  private readonly getWorkspaceRoot: () => string;
  private readonly now: () => number;
  private readonly renderer: AssetArtifactRenderer;

  constructor(options: AssetArtifactEngineOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.getWorkspaceRoot = options.getWorkspaceRoot ?? getAssetsWorkspaceRoot;
    this.registry =
      options.registry ??
      new AssetRegistry({
        db: this.db,
        getWorkspaceRoot: this.getWorkspaceRoot,
      });
    this.now = options.now ?? Date.now;
    this.renderer = options.renderer ?? renderArtifact;
  }

  async generate(
    input: GenerateAssetArtifactInput,
  ): Promise<GenerateAssetArtifactResult> {
    const existing = await this.existingArtifact(input);
    if (existing) {
      return { generated: false, skippedReason: 'already-ready', ...existing };
    }

    const source = await resolveAssetDerivativeSource({
      db: this.db,
      registry: this.registry,
      assetId: input.assetId,
      contentHash: input.contentHash,
      workspaceRoot: this.getWorkspaceRoot(),
    });
    if (!supportsArtifact(source.asset, input.kind)) {
      return { generated: false, skippedReason: 'unsupported-kind' };
    }

    const outputPath = artifactPathFor(
      this.getWorkspaceRoot(),
      input.contentHash,
      input.kind,
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await this.renderer({
      asset: source.asset,
      kind: input.kind,
      sourcePath: source.sourcePath,
      outputPath,
      workspaceRoot: this.getWorkspaceRoot(),
      signal: input.signal,
    });
    const stat = await fs.stat(outputPath);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO asset_preview_artifacts (
          content_hash, kind, data_path, bytes, generated_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.contentHash, input.kind, outputPath, stat.size, this.now());
    logger.info('assets.artifact.generated', {
      asset_id: input.assetId,
      kind: input.kind,
      bytes: stat.size,
    });
    return { generated: true, path: outputPath, bytes: stat.size };
  }

  private async existingArtifact(input: GenerateAssetArtifactInput): Promise<{
    path: string;
    bytes: number;
  } | null> {
    const row = this.db
      .prepare(
        `SELECT data_path, bytes
         FROM asset_preview_artifacts
         WHERE content_hash = ? AND kind = ?`,
      )
      .get(input.contentHash, input.kind) as
      | { data_path: string; bytes: number }
      | undefined;
    if (!row) return null;
    const stat = await fs.stat(row.data_path).catch(() => null);
    if (stat?.isFile()) return { path: row.data_path, bytes: row.bytes };
    this.db
      .prepare(
        'DELETE FROM asset_preview_artifacts WHERE content_hash = ? AND kind = ?',
      )
      .run(input.contentHash, input.kind);
    return null;
  }
}

function artifactPathFor(
  workspaceRoot: string,
  contentHash: string,
  kind: PreviewArtifactKind,
): string {
  const ext =
    kind === 'waveform' ? '.bin' : kind === 'poster' ? '.jpg' : '.jsonl';
  return path.join(
    assetDerivativeDir(workspaceRoot, 'artifacts', contentHash),
    `${kind}${ext}`,
  );
}

function supportsArtifact(asset: Asset, kind: PreviewArtifactKind): boolean {
  if (kind === 'filmstrip') return asset.kind === 'video';
  if (kind === 'waveform')
    return asset.kind === 'audio' || asset.kind === 'video';
  return asset.kind === 'pdf';
}

async function renderArtifact(input: {
  asset: Asset;
  kind: PreviewArtifactKind;
  sourcePath: string;
  outputPath: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.kind === 'filmstrip') return renderFilmstrip(input);
  if (input.kind === 'waveform') return renderWaveform(input);
  return renderPoster(input);
}

async function renderFilmstrip(input: {
  asset: Asset;
  sourcePath: string;
  outputPath: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}): Promise<void> {
  const frameDir = path.join(path.dirname(input.outputPath), 'filmstrip');
  await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(frameDir, { recursive: true });
  const pattern = path.join(frameDir, 'frame-%03d.jpg');
  const durationSec = Math.max((input.asset.durationMs ?? 0) / 1000, 1);
  const result = await runFFmpeg(
    [
      '-i',
      input.sourcePath,
      '-vf',
      `fps=${FILMSTRIP_FRAME_COUNT}/${durationSec},scale=160:-2`,
      '-frames:v',
      String(FILMSTRIP_FRAME_COUNT),
      '-q:v',
      '3',
      pattern,
    ],
    { inputDuration: durationSec, abortSignal: input.signal },
  );
  if (result.exitCode !== 0) {
    throw new AssetsError('Asset filmstrip generation failed', 502, {
      stderr: result.stderr.slice(0, 500),
    });
  }
  const entries = await fs.readdir(frameDir);
  const frames = entries
    .filter((entry) => entry.endsWith('.jpg'))
    .sort()
    .map((entry, index) =>
      JSON.stringify({
        timestamp_ms: Math.round(
          (index / FILMSTRIP_FRAME_COUNT) * durationSec * 1000,
        ),
        path: relativeWorkspacePath(
          input.workspaceRoot,
          path.join(frameDir, entry),
        ),
      }),
    )
    .join('\n');
  await fs.writeFile(input.outputPath, frames ? `${frames}\n` : '', 'utf8');
}

async function renderWaveform(input: {
  asset: Asset;
  sourcePath: string;
  outputPath: string;
  signal?: AbortSignal;
}): Promise<void> {
  const durationSec = Math.max((input.asset.durationMs ?? 0) / 1000, 1);
  const samplesPerWindow = Math.max(
    1,
    Math.floor((durationSec * 4000) / WAVEFORM_BINS),
  );
  const result = await runFFmpeg(
    [
      '-i',
      input.sourcePath,
      '-vn',
      '-af',
      `aformat=channel_layouts=mono,aresample=4000,astats=metadata=1:reset=${samplesPerWindow},ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-`,
      '-f',
      'null',
      nullOutputPath(),
    ],
    { inputDuration: durationSec, abortSignal: input.signal },
  );
  if (result.exitCode !== 0) {
    throw new AssetsError('Asset waveform generation failed', 502, {
      stderr: result.stderr.slice(0, 500),
    });
  }
  await fs.writeFile(input.outputPath, waveformBuffer(result.stderr));
}

async function renderPoster(input: {
  asset: Asset;
  outputPath: string;
}): Promise<void> {
  const sharp = (await import('sharp')).default;
  const label = escapeXml(input.asset.title ?? 'PDF');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1680"><rect width="1280" height="1680" fill="#f8fafc"/><rect x="120" y="96" width="1040" height="1488" rx="32" fill="#fff" stroke="#cbd5e1" stroke-width="8"/><text x="200" y="420" font-family="Arial" font-size="132" font-weight="700" fill="#dc2626">PDF</text><text x="200" y="560" font-family="Arial" font-size="54" fill="#334155">${label}</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 84 }).toFile(input.outputPath);
}

function waveformBuffer(stderr: string): Buffer {
  const values: number[] = [];
  const re = /lavfi\.astats\.Overall\.Peak_level=(-?\d+(?:\.\d+)?|-inf)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stderr)) !== null && values.length < WAVEFORM_BINS) {
    const raw = match[1];
    const db = raw === '-inf' ? Number.NEGATIVE_INFINITY : Number(raw);
    const amp = Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
    values.push(Math.max(0, Math.min(1, amp)));
  }
  while (values.length < WAVEFORM_BINS) values.push(0);
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function nullOutputPath(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

function escapeXml(value: string): string {
  return value
    .slice(0, 64)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
