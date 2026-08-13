import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getSetting } from '@/shared/db/operations';
import {
  cloudStorageRegistry,
  resolveNativeLocalAdapter,
  type CloudStorageAdapter,
  type LicenseInfo,
} from '@/shared/integrations/cloud-storage';
import { renderAttribution } from '@/shared/integrations/cloud-storage/content/attribution-renderer';

import {
  PROXY_PRESETS,
  type MaterializeLicense,
  type MaterializeResult,
  type ProxyPreset,
} from './materializer-types';
import type { Asset } from './types';

export interface MaterializationRow {
  id: string;
  active_path: string;
  content_hash: string | null;
  bytes: number;
  license_snapshot_json: string | null;
}

export interface CacheRow {
  content_hash: string;
  cache_path: string;
  bytes: number;
}

export interface SourceFileHint {
  name: string | null;
  size: number;
  modifiedAt: number | null;
}

export async function defaultResolveAdapter(
  asset: Asset,
): Promise<CloudStorageAdapter | null> {
  if (!asset.connectionId) return null;
  return (
    resolveNativeLocalAdapter(asset.connectionId) ??
    cloudStorageRegistry.resolve(asset.connectionId)
  );
}

export async function writeResponseBody(
  response: Response,
  target: string,
  opts: {
    total: number | null;
    signal?: AbortSignal;
    onProgress?: (bytes: number, total: number | null) => void;
  },
): Promise<{ bytes: number; contentHash: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const handle = await fs.open(target, 'w');
  try {
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      hash.update(buffer);
      bytes = buffer.byteLength;
      await handle.write(buffer);
      opts.onProgress?.(bytes, opts.total);
    } else {
      const reader = response.body.getReader();
      try {
        for (;;) {
          opts.signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          hash.update(chunk);
          bytes += chunk.byteLength;
          await handle.write(chunk);
          opts.onProgress?.(bytes, opts.total);
        }
      } finally {
        reader.releaseLock();
      }
    }
    await handle.sync();
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  } finally {
    await handle.close().catch(() => {});
  }
  return { bytes, contentHash: hash.digest('hex') };
}

export async function appendResponseBody(
  response: Response,
  target: string,
  opts: {
    total: number | null;
    startBytes: number;
    signal?: AbortSignal;
    onProgress?: (bytes: number, total: number | null) => void;
  },
): Promise<{ bytes: number }> {
  let bytes = 0;
  const handle = await fs.open(target, 'a');
  try {
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      bytes = buffer.byteLength;
      await handle.write(buffer);
      opts.onProgress?.(opts.startBytes + bytes, opts.total);
    } else {
      const reader = response.body.getReader();
      try {
        for (;;) {
          opts.signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          bytes += chunk.byteLength;
          await handle.write(chunk);
          opts.onProgress?.(opts.startBytes + bytes, opts.total);
        }
      } finally {
        reader.releaseLock();
      }
    }
    await handle.sync();
  } finally {
    await handle.close().catch(() => {});
  }
  return { bytes };
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function copyMaterializedFile(
  sourcePath: string,
  targetPath: string,
  strategy: 'clone' | 'copy' | 'hardlink',
): Promise<void> {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rm(targetPath, { force: true }).catch(() => {});
  if (strategy === 'hardlink') {
    await fs
      .link(sourcePath, targetPath)
      .catch(() => fs.copyFile(sourcePath, targetPath));
    return;
  }
  if (strategy === 'copy') {
    await fs.copyFile(sourcePath, targetPath);
    return;
  }
  await fs
    .copyFile(sourcePath, targetPath, fsConstants.COPYFILE_FICLONE_FORCE)
    .catch(() =>
      fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_FICLONE),
    )
    .catch(() => fs.copyFile(sourcePath, targetPath));
}

export function cachePathFor(
  workspaceRoot: string,
  provider: string,
  hash: string,
  ext: string,
): string {
  return path.join(
    workspaceRoot,
    '.cache',
    'assets',
    'remote',
    safeSegment(provider),
    hash.slice(0, 2),
    `${hash.slice(2)}${ext}`,
  );
}

export function extensionForCache(mime: string, title: string | null): string {
  const titleExt = title ? path.extname(title) : '';
  if (titleExt) return titleExt;
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'audio/mpeg') return '.mp3';
  return '.bin';
}

export function assetUrls(assetId: string): MaterializeResult['urls'] {
  const id = encodeURIComponent(assetId);
  const proxy = Object.fromEntries(
    PROXY_PRESETS.map((preset) => [preset, `/assets/${id}/proxy/${preset}`]),
  ) as Record<ProxyPreset, string>;
  return {
    raw: `/assets/${id}/raw`,
    preview: `/assets/${id}/preview`,
    proxy,
    filmstrip: `/assets/${id}/filmstrip`,
    waveform: `/assets/${id}/waveform`,
    poster: `/assets/${id}/poster`,
  };
}

export function licenseSnapshotFor(asset: Asset): MaterializeLicense | null {
  const licenseInfo = licenseInfoFromProvenance(asset.provenance);
  if (!licenseInfo) return null;
  return {
    provider: licenseInfo.provider ?? asset.source,
    attribution: renderAttribution(licenseInfo, 'text') ?? undefined,
    attributionRequired: Boolean(licenseInfo.requiresAttribution),
    licenseCode: licenseInfo.license,
    raw: licenseInfo,
  };
}

export function parseLicense(raw: string | null): MaterializeLicense | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MaterializeLicense;
  } catch {
    return null;
  }
}

export function settingNumber(key: string, fallback: number): number {
  const parsed = Number(getSetting(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sourceFileHintForAsset(asset: Asset): SourceFileHint | null {
  if (asset.bytes < 0) return null;
  return {
    name: normalizeHintName(asset.title),
    size: asset.bytes,
    modifiedAt: Number.isFinite(asset.modifiedAt) ? asset.modifiedAt : null,
  };
}

export function sourceFileHintsMatch(
  left: SourceFileHint | null,
  right: SourceFileHint | null,
): boolean {
  if (!left || !right) return false;
  if (left.size !== right.size) return false;
  if (left.name && right.name && left.name !== right.name) return false;
  if (
    left.modifiedAt !== null &&
    right.modifiedAt !== null &&
    left.modifiedAt !== right.modifiedAt
  ) {
    return false;
  }
  return Boolean(
    (left.name && right.name) ||
    (left.modifiedAt !== null && right.modifiedAt !== null),
  );
}

export function parseSourceFileHint(raw: string | null): SourceFileHint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const size = Number(record.size);
    if (!Number.isFinite(size) || size < 0) return null;
    const modifiedAt = Number(record.modifiedAt ?? record.lastModified);
    return {
      name:
        typeof record.name === 'string' ? normalizeHintName(record.name) : null,
      size,
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null,
    };
  } catch {
    return null;
  }
}

export function stringifySourceFileHint(
  hint: SourceFileHint | null,
): string | null {
  return hint ? JSON.stringify(hint) : null;
}

export function isSha256(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value));
}

export function numberHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function safeSegment(value: string): string {
  return value.replace(/[^\w.-]/g, '_') || 'unknown';
}

function normalizeHintName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function licenseInfoFromProvenance(provenance: unknown): LicenseInfo | null {
  if (!provenance || typeof provenance !== 'object') return null;
  const value = (provenance as { licenseInfo?: unknown }).licenseInfo;
  return value && typeof value === 'object' ? (value as LicenseInfo) : null;
}
