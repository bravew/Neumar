import fs from 'node:fs/promises';

import { readMediaMetadata } from '@/shared/media/probe';

import type { Asset } from '../types';

const MAX_PDF_PROBE_BYTES = 100 * 1024 * 1024;

export interface AssetProbeResult {
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  exif?: Record<string, unknown>;
}

export async function probeAssetFile(
  asset: Asset,
  filePath: string,
  workspaceRoot: string,
): Promise<AssetProbeResult> {
  const stat = await fs.stat(filePath);
  if (asset.kind === 'pdf') {
    const pdf =
      stat.size <= MAX_PDF_PROBE_BYTES
        ? await probePdf(filePath).catch(() => null)
        : null;
    return {
      bytes: stat.size,
      width: pdf?.width,
      height: pdf?.height,
      exif: pdf
        ? {
            pageCount: pdf.pageCount,
          }
        : undefined,
    };
  }

  if (asset.kind === 'image') {
    const image = await probeImage(filePath).catch(() => null);
    if (image) return { bytes: stat.size, ...image };
  }

  if (
    asset.kind === 'image' ||
    asset.kind === 'video' ||
    asset.kind === 'audio'
  ) {
    const metadata = await readMediaMetadata(filePath, workspaceRoot);
    return {
      bytes: metadata.fileSize ?? stat.size,
      width: metadata.width,
      height: metadata.height,
      durationMs: metadata.durationMs || undefined,
    };
  }

  return { bytes: stat.size };
}

async function probeImage(filePath: string): Promise<{
  width?: number;
  height?: number;
  exif?: Record<string, unknown>;
}> {
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(filePath).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    exif: metadata.exif ? { hasEmbeddedExif: true } : undefined,
  };
}

async function probePdf(
  filePath: string,
): Promise<{ pageCount: number; width?: number; height?: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = Uint8Array.from(await fs.readFile(filePath));
  // PDF.js v6 removed the legacy isEvalSupported document option; keep the
  // remaining probe options worker-free and font-rendering-free for metadata.
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useWorkerFetch: false,
  });
  try {
    const doc = await task.promise;
    const firstPage = doc.numPages > 0 ? await doc.getPage(1) : null;
    const viewport = firstPage?.getViewport({ scale: 1 });
    firstPage?.cleanup();
    return {
      pageCount: doc.numPages,
      width: viewport ? Math.round(viewport.width) : undefined,
      height: viewport ? Math.round(viewport.height) : undefined,
    };
  } finally {
    await task.destroy();
  }
}
