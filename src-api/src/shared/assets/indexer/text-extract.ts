import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import type { Asset } from '../types';

const logger = createLogger('Assets/Indexer');
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 200_000;
const MAX_PDF_TEXT_BYTES = 100 * 1024 * 1024;
const require = createRequire(import.meta.url);
const TEXT_EXTENSIONS = new Set([
  '.csv',
  '.json',
  '.log',
  '.md',
  '.markdown',
  '.txt',
]);

export async function extractIndexableText(
  asset: Asset,
  filePath: string,
): Promise<string | null> {
  try {
    if (asset.kind === 'pdf' || asset.mime === 'application/pdf') {
      return normalizeExtractedText(await extractPdfText(filePath));
    }
    if (isPlainTextAsset(asset, filePath)) {
      return normalizeExtractedText(await readPlainTextPrefix(filePath));
    }
  } catch (error) {
    logger.warn('assets.indexer.text_extract_failed', {
      asset_id: asset.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

async function extractPdfText(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_PDF_TEXT_BYTES) return '';
  const pdfParse = require('pdf-parse') as (
    buffer: Buffer,
  ) => Promise<{ text: string }>;
  const result = await pdfParse(await fs.readFile(filePath));
  return result.text;
}

async function readPlainTextPrefix(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  const length = Math.min(stat.size, MAX_TEXT_BYTES);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function isPlainTextAsset(asset: Asset, filePath: string): boolean {
  return (
    asset.kind === 'text' ||
    asset.mime.startsWith('text/') ||
    TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  );
}

function normalizeExtractedText(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_TEXT_CHARS);
}
