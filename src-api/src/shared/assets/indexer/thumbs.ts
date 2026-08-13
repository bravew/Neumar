import fs from 'node:fs/promises';
import path from 'node:path';

import { runFFmpeg } from '@/shared/services/ffmpeg';

import type { Asset } from '../types';

export interface AssetDerivativeResult {
  thumbPath?: string;
  previewPath?: string;
}

export async function generateAssetDerivatives(input: {
  asset: Asset;
  filePath: string;
  workspaceRoot: string;
}): Promise<AssetDerivativeResult> {
  const { asset, filePath, workspaceRoot } = input;
  const dir = await ensureAssetDerivativeDir(workspaceRoot, asset.id);

  if (asset.kind === 'image') {
    return generateImageDerivatives(filePath, dir, workspaceRoot);
  }
  if (asset.kind === 'video') {
    return generateVideoThumbnail(asset, filePath, dir, workspaceRoot);
  }
  if (asset.kind === 'pdf') {
    return generatePdfDerivatives(asset, dir, workspaceRoot);
  }

  return {};
}

async function generateImageDerivatives(
  filePath: string,
  dir: string,
  workspaceRoot: string,
): Promise<AssetDerivativeResult> {
  const sharp = (await import('sharp')).default;
  const thumb = path.join(dir, 'thumb.webp');
  const preview = path.join(dir, 'preview.jpg');
  await sharp(filePath)
    .rotate()
    .resize({
      width: 320,
      height: 320,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toFile(thumb);
  await sharp(filePath)
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(preview);
  return {
    thumbPath: relativeFromWorkspace(workspaceRoot, thumb),
    previewPath: relativeFromWorkspace(workspaceRoot, preview),
  };
}

async function generateVideoThumbnail(
  asset: Asset,
  filePath: string,
  dir: string,
  workspaceRoot: string,
): Promise<AssetDerivativeResult> {
  const thumb = path.join(dir, 'thumb.jpg');
  const seekSeconds =
    asset.durationMs && asset.durationMs > 0
      ? Math.max(0, Math.min(3, asset.durationMs / 2000))
      : 0.1;
  const result = await runFFmpeg([
    '-ss',
    seekSeconds.toFixed(3),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-2',
    '-q:v',
    '3',
    thumb,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg thumbnail failed: ${result.stderr.slice(0, 500)}`);
  }
  return { thumbPath: relativeFromWorkspace(workspaceRoot, thumb) };
}

async function generatePdfDerivatives(
  asset: Asset,
  dir: string,
  workspaceRoot: string,
): Promise<AssetDerivativeResult> {
  const sharp = (await import('sharp')).default;
  const thumb = path.join(dir, 'thumb.webp');
  const preview = path.join(dir, 'preview.webp');
  const source = Buffer.from(pdfPlaceholderSvg(asset.title ?? 'PDF'));
  await sharp(source)
    .resize({
      width: 320,
      height: 320,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toFile(thumb);
  await sharp(source)
    .resize({
      width: 1024,
      height: 1024,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 84 })
    .toFile(preview);
  return {
    thumbPath: relativeFromWorkspace(workspaceRoot, thumb),
    previewPath: relativeFromWorkspace(workspaceRoot, preview),
  };
}

async function ensureAssetDerivativeDir(
  workspaceRoot: string,
  assetId: string,
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(assetId)) {
    throw new Error('Invalid asset id for derivative path');
  }
  const dir = path.join(workspaceRoot, '.cache', 'assets', assetId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function relativeFromWorkspace(
  workspaceRoot: string,
  filePath: string,
): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Derivative path escaped workspace');
  }
  return relativePath.split(path.sep).join('/');
}

function pdfPlaceholderSvg(title: string): string {
  const label = escapeXml(title.slice(0, 42));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="840" viewBox="0 0 640 840">
  <rect width="640" height="840" fill="#f8fafc"/>
  <rect x="72" y="64" width="496" height="712" rx="16" fill="#ffffff" stroke="#cbd5e1" stroke-width="4"/>
  <path d="M440 64v144h128" fill="#e2e8f0"/>
  <text x="112" y="220" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#dc2626">PDF</text>
  <text x="112" y="304" font-family="Arial, sans-serif" font-size="30" fill="#334155">${label}</text>
  <line x1="112" y1="392" x2="528" y2="392" stroke="#cbd5e1" stroke-width="6"/>
  <line x1="112" y1="456" x2="528" y2="456" stroke="#e2e8f0" stroke-width="6"/>
  <line x1="112" y1="520" x2="460" y2="520" stroke="#e2e8f0" stroke-width="6"/>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
