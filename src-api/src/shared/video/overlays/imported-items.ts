import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { createLogger } from '@/shared/utils/logger';

import { getVideoWorkspaceRoot } from '../store';

const logger = createLogger('VideoImportedOverlays');

export const IMPORTED_OVERLAY_FILE = 'imported-overlays.json';
export const IMPORTED_OVERLAY_SCHEMA_ID = 'neuma.video.imported-overlays.v1';
const IMPORTED_OVERLAY_ASSET_DIR = 'overlay-imports';
const MAX_IMPORTED_OVERLAY_BYTES = 5 * 1024 * 1024;

export const ImportedOverlayItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    kind: z.enum(['gif', 'lottie']),
    relativePath: z.string().min(1).refine(isSafeImportRelativePath),
    source: z
      .object({
        kind: z.literal('local-upload'),
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().positive(),
      })
      .strict(),
    provenance: z
      .object({
        kind: z.literal('import'),
        provider: z.literal('local'),
        createdAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const ImportedOverlayFileSchema = z
  .object({
    schema: z.literal(IMPORTED_OVERLAY_SCHEMA_ID),
    imports: z.array(ImportedOverlayItemSchema),
  })
  .strict();

export const SaveImportedOverlayInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    fileName: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(120),
    dataBase64: z.string().min(1),
  })
  .strict();

export type ImportedOverlayItem = z.infer<typeof ImportedOverlayItemSchema>;
export type SaveImportedOverlayInput = z.infer<
  typeof SaveImportedOverlayInputSchema
>;

function storePath(): string {
  return path.join(getVideoWorkspaceRoot(), IMPORTED_OVERLAY_FILE);
}

export async function listImportedOverlayItems(): Promise<
  ImportedOverlayItem[]
> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = ImportedOverlayFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn('video.imported_overlays.invalid_store_file', {
        path: storePath(),
      });
      return [];
    }
    return parsed.data.imports;
  } catch {
    return [];
  }
}

export async function saveImportedOverlayItem(
  input: SaveImportedOverlayInput,
): Promise<ImportedOverlayItem> {
  const parsed = SaveImportedOverlayInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ImportedOverlayError('Invalid import input', 'invalid_input');
  }
  const buffer = decodeBase64(parsed.data.dataBase64);
  if (buffer.length === 0 || buffer.length > MAX_IMPORTED_OVERLAY_BYTES) {
    throw new ImportedOverlayError(
      'Imported overlay file is empty or too large',
      'invalid_size',
    );
  }
  const kind = importedOverlayKind(
    parsed.data.fileName,
    parsed.data.mimeType,
    buffer,
  );
  const id = `import:${randomUUID()}`;
  const extension = kind === 'gif' ? '.gif' : '.json';
  const relativePath = path.join(
    IMPORTED_OVERLAY_ASSET_DIR,
    `${id.replace(/[^a-zA-Z0-9_-]/g, '-')}${extension}`,
  );
  const absolutePath = resolveImportAssetPath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  const item: ImportedOverlayItem = {
    id,
    name: parsed.data.name.trim().slice(0, 80),
    kind,
    relativePath,
    source: {
      kind: 'local-upload',
      fileName: parsed.data.fileName,
      mimeType: normalizedMimeType(kind, parsed.data.mimeType),
      sizeBytes: buffer.length,
    },
    provenance: {
      kind: 'import',
      provider: 'local',
      createdAt: new Date().toISOString(),
    },
  };
  const imports = await listImportedOverlayItems();
  await writeStore([...imports, item]);
  logger.info('video.imported_overlays.saved', {
    import_id: item.id,
    kind: item.kind,
  });
  return item;
}

export async function deleteImportedOverlayItem(id: string): Promise<boolean> {
  const imports = await listImportedOverlayItems();
  const item = imports.find((candidate) => candidate.id === id);
  if (!item) return false;
  const remaining = imports.filter((candidate) => candidate.id !== id);
  await writeStore(remaining);
  await fs.rm(resolveImportAssetPath(item.relativePath), {
    force: true,
  });
  logger.info('video.imported_overlays.deleted', { import_id: id });
  return true;
}

export async function getImportedOverlayAsset(
  id: string,
): Promise<{ item: ImportedOverlayItem; bytes: Buffer } | null> {
  const item = (await listImportedOverlayItems()).find(
    (candidate) => candidate.id === id,
  );
  if (!item) return null;
  return {
    item,
    bytes: await fs.readFile(resolveImportAssetPath(item.relativePath)),
  };
}

async function writeStore(imports: ImportedOverlayItem[]): Promise<void> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(
    storePath(),
    JSON.stringify({ schema: IMPORTED_OVERLAY_SCHEMA_ID, imports }, null, 2),
    'utf8',
  );
}

function isSafeImportRelativePath(value: string): boolean {
  if (value.includes('\0')) return false;
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  const parts = normalized.split(/[\\/]+/);
  if (parts.includes('..')) return false;
  return (
    parts.length === 2 &&
    parts[0] === IMPORTED_OVERLAY_ASSET_DIR &&
    /^import-[a-zA-Z0-9_-]+\.(gif|json)$/.test(parts[1] ?? '')
  );
}

function resolveImportAssetPath(relativePath: string): string {
  if (!isSafeImportRelativePath(relativePath)) {
    throw new ImportedOverlayError('Invalid import asset path', 'invalid_path');
  }
  return path.resolve(getVideoWorkspaceRoot(), relativePath);
}

function decodeBase64(value: string): Buffer {
  const normalized = value.trim().replace(/\s+/g, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new ImportedOverlayError(
      'Invalid base64 import data',
      'invalid_data',
    );
  }
  const buffer = Buffer.from(normalized, 'base64');
  const encoded = buffer.toString('base64').replace(/=+$/, '');
  const input = normalized.replace(/=+$/, '');
  if (encoded !== input) {
    throw new ImportedOverlayError(
      'Invalid base64 import data',
      'invalid_data',
    );
  }
  return buffer;
}

function importedOverlayKind(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): ImportedOverlayItem['kind'] {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime === 'image/gif' || lowerName.endsWith('.gif')) {
    if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a') return 'gif';
    if (buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
    throw new ImportedOverlayError('Invalid GIF import data', 'invalid_gif');
  }
  if (
    lowerMime === 'application/json' ||
    lowerMime === 'application/lottie+json' ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.lottie')
  ) {
    validateLottieJson(buffer);
    return 'lottie';
  }
  throw new ImportedOverlayError(
    'Only local GIF and Lottie JSON imports are supported',
    'unsupported_type',
  );
}

function validateLottieJson(buffer: Buffer): void {
  try {
    const parsed = JSON.parse(buffer.toString('utf8')) as {
      layers?: unknown;
      v?: unknown;
    };
    if (!Array.isArray(parsed.layers) || typeof parsed.v !== 'string') {
      throw new Error('missing lottie fields');
    }
  } catch {
    throw new ImportedOverlayError(
      'Invalid Lottie JSON import data',
      'invalid_lottie',
    );
  }
}

function normalizedMimeType(
  kind: ImportedOverlayItem['kind'],
  fallback: string,
): string {
  if (kind === 'gif') return 'image/gif';
  return fallback || 'application/json';
}

export class ImportedOverlayError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ImportedOverlayError';
  }
}
