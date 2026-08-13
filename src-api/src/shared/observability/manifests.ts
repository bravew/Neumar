import { createHash } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { redactValue } from '@/shared/utils/logger';

export const TRACE_SAFE_MANIFEST_SCHEMA = 'neuma.trace.safe-manifest.v1';

export type TraceSafeManifestType =
  | 'attachment_manifest'
  | 'artifact_manifest'
  | 'input_text_snapshot_manifest';

export type TraceSafeManifestRedaction =
  | 'none'
  | 'hashed'
  | 'redacted'
  | 'truncated'
  | 'missing';

export type TraceSafeManifestStatus =
  | 'available'
  | 'missing'
  | 'pending'
  | 'failed'
  | 'redacted';

export interface TraceSafeManifestEntry {
  id: string;
  kind: string;
  taskId?: string;
  projectId?: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  storageRef?: string;
  pathHint?: string;
  redaction: TraceSafeManifestRedaction;
  status: TraceSafeManifestStatus;
  previewStatus?: TraceSafeManifestStatus | 'not_instrumented';
  retentionHint?: string;
  summary?: string;
}

export interface TraceSafeManifest {
  schema: typeof TRACE_SAFE_MANIFEST_SCHEMA;
  manifestType: TraceSafeManifestType;
  entries: TraceSafeManifestEntry[];
  totalEntries: number;
  totalByteSize: number | null;
  generatedAt: string;
}

export interface TraceFileManifestInput {
  filePath: string;
  manifestType: Extract<
    TraceSafeManifestType,
    'attachment_manifest' | 'artifact_manifest'
  >;
  id?: string;
  kind?: string;
  taskId?: string;
  projectId?: string;
  /**
   * Workspace root used to create a workspace:// storage ref for files inside
   * the project. Files outside this root fall back to an opaque path hash.
   */
  workspaceRoot?: string;
  storageRef?: string;
  summary?: string;
  retentionHint?: string;
  previewStatus?: TraceSafeManifestEntry['previewStatus'];
  hashByteLimit?: number;
}

export interface InputTextSnapshotManifestInput {
  text: string;
  taskId?: string;
  projectId?: string;
  id?: string;
  includeRedactedSnippet?: boolean;
  summaryMaxLength?: number;
}

/**
 * Create a synchronous, content-free artifact reference for trace aggregation.
 * The path is represented only by an opaque hash and is never serialized.
 */
export function createTraceArtifactReference(input: {
  filePath: string;
  taskId?: string;
  projectId?: string;
}): TraceSafeManifestEntry {
  let canonicalPath = input.filePath;
  try {
    canonicalPath = realpathSync(input.filePath);
  } catch {
    // Missing files still receive a stable normalized reference.
  }
  const pathHash = opaquePathHash(canonicalPath);
  return {
    id: `artifact:path:${pathHash}`,
    kind: inferKind(canonicalPath),
    taskId: input.taskId,
    projectId: input.projectId,
    mimeType: inferMimeType(canonicalPath),
    storageRef: `local-file://sha256/${pathHash}`,
    redaction: 'hashed',
    status: 'available',
    previewStatus: 'not_instrumented',
    summary: 'Produced artifact reference',
  };
}

const SUMMARY_MAX_LENGTH = 160;

const MIME_BY_EXT: Record<string, string> = {
  '.aac': 'audio/aac',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
};

function truncateSummary(value: string, limit = SUMMARY_MAX_LENGTH): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function inferMimeType(filePath: string): string {
  return (
    MIME_BY_EXT[path.extname(filePath).toLowerCase()] ??
    'application/octet-stream'
  );
}

function inferKind(filePath: string): string {
  const mimeType = inferMimeType(filePath);
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'text/html') return 'html';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    return 'text';
  }
  return 'file';
}

function pathHintFor(filePath: string): string {
  return path.basename(filePath);
}

function opaquePathHash(filePath: string): string {
  return createHash('sha256')
    .update(path.resolve(filePath), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

function pathBasedEntryId(
  manifestType: TraceFileManifestInput['manifestType'],
  filePath: string,
): string {
  return `${manifestType}:path:${opaquePathHash(filePath)}`;
}

function safeStorageRef(
  filePath: string,
  options: { workspaceRoot?: string; sha256?: string; storageRef?: string },
): string {
  if (options.storageRef) return options.storageRef;

  if (options.workspaceRoot) {
    const root = path.resolve(options.workspaceRoot);
    const resolved = path.resolve(filePath);
    const relative = path.relative(root, resolved);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return `workspace://${relative.split(path.sep).join('/')}`;
    }
  }

  if (options.sha256) return `sha256://${options.sha256}`;
  return `local-file://sha256/${opaquePathHash(filePath)}`;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function createTraceFileManifestEntry(
  input: TraceFileManifestInput,
): Promise<TraceSafeManifestEntry> {
  const filePath = path.resolve(input.filePath);
  const pathHint = pathHintFor(filePath);
  const baseEntry = {
    id: input.id ?? pathBasedEntryId(input.manifestType, filePath),
    kind: input.kind ?? inferKind(filePath),
    taskId: input.taskId,
    projectId: input.projectId,
    mimeType: inferMimeType(filePath),
    pathHint,
    retentionHint: input.retentionHint,
    previewStatus: input.previewStatus ?? 'not_instrumented',
    summary: input.summary
      ? truncateSummary(input.summary)
      : truncateSummary(pathHint),
  };

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return {
        ...baseEntry,
        storageRef: safeStorageRef(filePath, input),
        redaction: 'redacted',
        status: 'failed',
        summary: truncateSummary(`${pathHint} is not a regular file`),
      };
    }

    const byteSize = fileStat.size;
    if (input.hashByteLimit !== undefined && byteSize > input.hashByteLimit) {
      return {
        ...baseEntry,
        byteSize,
        storageRef: safeStorageRef(filePath, input),
        redaction: 'truncated',
        status: 'available',
        summary: truncateSummary(
          `${pathHint} metadata only; SHA-256 skipped because it exceeds the trace hash limit`,
        ),
      };
    }

    const sha256 = await hashFile(filePath);
    return {
      ...baseEntry,
      id: input.id ?? `${input.manifestType}:${sha256.slice(0, 16)}`,
      byteSize,
      sha256,
      storageRef: safeStorageRef(filePath, { ...input, sha256 }),
      redaction: 'none',
      status: 'available',
    };
  } catch {
    return {
      ...baseEntry,
      storageRef: safeStorageRef(filePath, input),
      redaction: 'missing',
      status: 'missing',
      summary: truncateSummary(`${pathHint} is missing`),
    };
  }
}

export function createInputTextSnapshotManifest(
  input: InputTextSnapshotManifestInput,
): TraceSafeManifest {
  const byteSize = Buffer.byteLength(input.text, 'utf8');
  const sha256 = createHash('sha256').update(input.text, 'utf8').digest('hex');
  const redacted = input.includeRedactedSnippet
    ? String(redactValue(input.text))
    : '';
  const entry: TraceSafeManifestEntry = {
    id: input.id ?? `input:${sha256.slice(0, 16)}`,
    kind: 'input_text',
    taskId: input.taskId,
    projectId: input.projectId,
    mimeType: 'text/plain',
    byteSize,
    sha256,
    storageRef: `sha256://${sha256}`,
    redaction: input.includeRedactedSnippet ? 'redacted' : 'hashed',
    status: 'available',
    summary: input.includeRedactedSnippet
      ? truncateSummary(redacted, input.summaryMaxLength ?? SUMMARY_MAX_LENGTH)
      : `Input text snapshot (${byteSize} bytes, SHA-256 only)`,
  };
  return createTraceSafeManifest('input_text_snapshot_manifest', [entry]);
}

export function createTraceSafeManifest(
  manifestType: TraceSafeManifestType,
  entries: TraceSafeManifestEntry[],
): TraceSafeManifest {
  const byteSizes = entries
    .map((entry) => entry.byteSize)
    .filter((value): value is number => typeof value === 'number');
  return {
    schema: TRACE_SAFE_MANIFEST_SCHEMA,
    manifestType,
    entries,
    totalEntries: entries.length,
    totalByteSize:
      byteSizes.length === entries.length
        ? byteSizes.reduce((sum, value) => sum + value, 0)
        : null,
    generatedAt: new Date().toISOString(),
  };
}

export function traceManifestAttrs(
  ...manifests: TraceSafeManifest[]
): Record<TraceSafeManifestType, TraceSafeManifest | undefined> {
  return manifests.reduce(
    (attrs, manifest) => {
      attrs[manifest.manifestType] = manifest;
      return attrs;
    },
    {} as Record<TraceSafeManifestType, TraceSafeManifest | undefined>,
  );
}
