import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import JSZip from 'jszip';

import type { AgentRunEventRow, AgentRunRow } from '@/shared/db/operations';
import { getAgentRun, getAgentRunEventsAfter } from '@/shared/db/operations';
import { getLogDirectory, redactValue } from '@/shared/utils/logger';

import { getExecutionDiagnostics } from './execution-diagnostics';
import { listTraceEventsForRun, type TraceEvent } from './trace';

const LOG_CATEGORIES = ['app', 'gateway', 'integrations', 'system'] as const;
const LOG_FILE_RE = /^(app|gateway|integrations|system)-(\d{2})-(\d{2})\.log$/;
const SAFE_MANIFEST_SCHEMA = 'neuma.trace.safe-manifest.v1';

export interface SupportBundleLimits {
  maxLogBytes: number;
  maxLineBytes: number;
  maxRecordBytes: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxArchiveBytes: number;
}

const DEFAULT_LIMITS: SupportBundleLimits = {
  maxLogBytes: 256 * 1024,
  maxLineBytes: 16 * 1024,
  maxRecordBytes: 32 * 1024,
  maxEntryBytes: 512 * 1024,
  maxTotalBytes: 3 * 1024 * 1024,
  maxArchiveBytes: 4 * 1024 * 1024,
};

export interface SupportBundleRequest {
  runId: string;
  mode: AgentRunRow['mode'];
  ownerKey: string;
  logDirectory?: string;
  now?: Date;
  limits?: Partial<SupportBundleLimits>;
}

export interface SupportBundleSources {
  getRun: (runId: string) => AgentRunRow | undefined;
  getEvents: (runId: string) => AgentRunEventRow[];
  getTraces: (ownerKey: string, runId: string) => TraceEvent[];
  getDiagnostics: (runId: string) => unknown;
}

const DEFAULT_SOURCES: SupportBundleSources = {
  getRun: getAgentRun,
  getEvents: (runId) => getAgentRunEventsAfter(runId, -1),
  getTraces: listTraceEventsForRun,
  getDiagnostics: getExecutionDiagnostics,
};

interface Omission {
  source: string;
  reason: string;
  byteSize?: number;
}

export async function buildSupportBundle(
  request: SupportBundleRequest,
  sources: SupportBundleSources = DEFAULT_SOURCES,
): Promise<{ data: Buffer; filename: string }> {
  const limits = { ...DEFAULT_LIMITS, ...request.limits };
  validateLimits(limits);
  const run = sources.getRun(request.runId);
  if (!run) throw new Error('Run not found');
  if (
    run.id !== request.runId ||
    run.mode !== request.mode ||
    run.owner_key !== request.ownerKey
  ) {
    throw new Error('Run owner mismatch');
  }

  const omissions: Omission[] = [];
  const entries = new Map<string, Buffer>();
  let totalBytes = 0;
  const addEntry = (name: string, value: string | Buffer) => {
    let data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    if (data.byteLength > limits.maxEntryBytes) {
      omissions.push({
        source: name,
        reason: 'entry_size_limit',
        byteSize: data.byteLength,
      });
      data = Buffer.from(
        JSON.stringify({
          type: 'OMITTED_OVERSIZED_ENTRY',
          byteSize: data.byteLength,
        }),
      );
    }
    if (totalBytes + data.byteLength > limits.maxTotalBytes) {
      omissions.push({
        source: name,
        reason: 'bundle_total_size_limit',
        byteSize: data.byteLength,
      });
      return;
    }
    entries.set(name, data);
    totalBytes += data.byteLength;
  };

  const now = request.now ?? new Date();
  const logDirectory = request.logDirectory ?? getLogDirectory();
  for (const logFile of await selectLogFiles(logDirectory, now, omissions)) {
    try {
      addEntry(
        `logs/${basename(logFile)}`,
        await readBoundedLogTail(logFile, {
          maxBytes: limits.maxLogBytes,
          maxLineBytes: limits.maxLineBytes,
        }),
      );
    } catch {
      omissions.push({ source: basename(logFile), reason: 'unreadable_log' });
    }
  }

  try {
    const eventLines = boundedJsonLines(
      sources.getEvents(request.runId),
      (event) => ({
        seq: event.seq,
        type: event.event_type,
        timestamp: event.created_at,
        terminalState: terminalState(event.event_type),
      }),
      limits,
      omissions,
      'run/events.jsonl',
    );
    addEntry('run/events.jsonl', eventLines);
  } catch {
    omissions.push({ source: 'events', reason: 'unreadable_optional_source' });
  }

  try {
    const traceLines = boundedJsonLines(
      sources.getTraces(request.ownerKey, request.runId),
      projectTrace,
      limits,
      omissions,
      'run/traces.jsonl',
    );
    addEntry('run/traces.jsonl', traceLines);
  } catch {
    omissions.push({ source: 'traces', reason: 'unreadable_optional_source' });
  }

  try {
    const diagnostics = sources.getDiagnostics(request.runId);
    if (diagnostics) {
      addEntry(
        'run/diagnostics.json',
        JSON.stringify(redactValue(diagnostics), null, 2),
      );
    }
  } catch {
    omissions.push({
      source: 'diagnostics',
      reason: 'unreadable_optional_source',
    });
  }

  addEntry(
    'version.json',
    JSON.stringify(
      {
        schema: 'neuma.support-bundle.v1',
        generatedAt: now.toISOString(),
        appVersion: process.env.npm_package_version ?? 'unknown',
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        run: {
          id: run.id,
          mode: run.mode,
          status: run.status,
          completeness: run.completeness,
          delivery: run.delivery,
          retry: run.retry,
          attempt: run.attempt,
          startedAt: run.started_at,
          finishedAt: run.finished_at,
        },
      },
      null,
      2,
    ),
  );

  addOmissionsEntry(
    entries,
    omissions,
    limits,
    () => totalBytes,
    (size) => {
      totalBytes += size;
    },
  );
  const filename = supportBundleFilename(request, now);
  let data = await generateZip(entries);
  if (data.byteLength > limits.maxArchiveBytes) {
    const fallback = new Map<string, Buffer>();
    const archiveOmission = boundedOmissionIndex(
      [
        ...omissions,
        {
          source: 'archive',
          reason: 'archive_size_limit',
          byteSize: data.byteLength,
        },
      ],
      Math.min(limits.maxEntryBytes, limits.maxTotalBytes),
    );
    fallback.set('omissions.json', archiveOmission);
    data = await generateZip(fallback);
  }
  if (data.byteLength > limits.maxArchiveBytes) {
    throw new Error('Support bundle archive size limit is too small');
  }
  return { data, filename };
}

export async function readBoundedLogTail(
  filePath: string,
  limits: { maxBytes: number; maxLineBytes: number },
): Promise<string> {
  const handle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const snapshot = await handle.stat();
    if (!snapshot.isFile()) throw new Error('Log source is not a regular file');
    const start = Math.max(0, snapshot.size - limits.maxBytes);
    const length = snapshot.size - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    let boundaryOmission = '';
    if (start > 0) {
      const boundary = text.indexOf('\n');
      if (boundary < 0) {
        return `[OMITTED_OVERSIZED_LOG_LINE ${snapshot.size} bytes]\n`;
      }
      boundaryOmission =
        Buffer.byteLength(text.slice(0, boundary), 'utf8') > limits.maxLineBytes
          ? `[OMITTED_OVERSIZED_LOG_LINE >=${boundary} bytes]\n`
          : '[OMITTED_TRUNCATED_LOG_LINE]\n';
      text = text.slice(boundary + 1);
    }
    const finalBoundary = text.lastIndexOf('\n');
    if (finalBoundary < 0) return '';
    const lines = text.slice(0, finalBoundary).split('\n');
    return `${boundaryOmission}${lines
      .map((line) => {
        const byteSize = Buffer.byteLength(line, 'utf8');
        return byteSize > limits.maxLineBytes
          ? `[OMITTED_OVERSIZED_LOG_LINE ${byteSize} bytes]`
          : redactSupportText(line);
      })
      .join('\n')}\n`;
  } finally {
    await handle.close();
  }
}

async function selectLogFiles(
  directory: string,
  now: Date,
  omissions: Omission[],
): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => LOG_FILE_RE.test(name));
  } catch {
    omissions.push({ source: 'logs', reason: 'log_directory_unavailable' });
    return [];
  }
  const currentStamp = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const selected: string[] = [];
  for (const category of LOG_CATEGORIES) {
    const matching = names.filter((name) => name.startsWith(`${category}-`));
    const currentName = `${category}-${currentStamp}.log`;
    const candidates = (
      await Promise.all(
        matching.map(async (name) => {
          try {
            const snapshot = await lstat(join(directory, name));
            return snapshot.isFile()
              ? { name, modified: snapshot.mtimeMs }
              : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((value): value is { name: string; modified: number } =>
      Boolean(value),
    );
    if (candidates.some(({ name }) => name === currentName)) {
      selected.push(join(directory, currentName));
    }
    const newestEarlier = candidates
      .filter(({ name }) => name !== currentName)
      .sort((left, right) => right.modified - left.modified)[0];
    if (newestEarlier) selected.push(join(directory, newestEarlier.name));
  }
  return selected;
}

function projectTrace(trace: TraceEvent) {
  return {
    id: trace.id,
    kind: trace.kind,
    status: trace.status,
    startedAt: trace.started_at,
    endedAt: trace.ended_at,
    durationMs: trace.duration_ms,
    provider: trace.provider,
    model: trace.model,
    tool: trace.tool,
    manifests: safeManifests(trace.attrs_json),
  };
}

function safeManifests(attrsJson: string | null): unknown[] {
  if (!attrsJson) return [];
  try {
    const attrs = JSON.parse(attrsJson) as Record<string, unknown>;
    return Object.values(attrs)
      .filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) &&
          typeof value === 'object' &&
          (value as Record<string, unknown>).schema === SAFE_MANIFEST_SCHEMA,
      )
      .map((manifest) => ({
        schema: manifest.schema,
        manifestType: manifest.manifestType,
        totalEntries: manifest.totalEntries,
        totalByteSize: manifest.totalByteSize,
        generatedAt: manifest.generatedAt,
        entries: Array.isArray(manifest.entries)
          ? manifest.entries.map(projectManifestEntry)
          : [],
      }));
  } catch {
    return [];
  }
}

function projectManifestEntry(value: unknown) {
  if (!value || typeof value !== 'object') return { status: 'redacted' };
  const entry = value as Record<string, unknown>;
  return redactValue({
    kind: entry.kind,
    mimeType: entry.mimeType,
    byteSize: entry.byteSize,
    sha256: entry.sha256,
    storageRef: safeStorageRef(entry.storageRef),
    redaction: entry.redaction,
    status: entry.status,
    previewStatus: entry.previewStatus,
  });
}

function safeStorageRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^(?:sha256:\/\/|local-file:\/\/sha256\/)[a-f0-9]{16,128}$/i.test(
    value,
  )
    ? value
    : undefined;
}

function boundedJsonLine(value: unknown, maxBytes: number): string {
  const serialized = JSON.stringify(redactValue(value));
  const byteSize = Buffer.byteLength(serialized, 'utf8');
  return byteSize > maxBytes
    ? `${JSON.stringify({ type: 'OMITTED_OVERSIZED_RECORD', byteSize })}\n`
    : `${serialized}\n`;
}

function boundedJsonLines<T>(
  values: readonly T[],
  project: (value: T) => unknown,
  limits: SupportBundleLimits,
  omissions: Omission[],
  source: string,
): string {
  const lines: string[] = [];
  let byteSize = 0;
  for (const value of values) {
    const line = boundedJsonLine(project(value), limits.maxRecordBytes);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (byteSize + lineBytes > limits.maxEntryBytes) {
      omissions.push({
        source,
        reason: 'entry_size_limit',
        byteSize: byteSize + lineBytes,
      });
      break;
    }
    lines.push(line);
    byteSize += lineBytes;
  }
  return lines.join('');
}

function terminalState(eventType: string): string | null {
  if (eventType === 'RUN_FINISHED') return 'completed';
  if (eventType === 'RUN_ERROR') return 'failed';
  return null;
}

function redactSupportText(value: string): string {
  const secretsRedacted = String(redactValue(value));
  return secretsRedacted
    .replace(/\\\\[^\\\s"']+(?:\\[^\\\s"']+)+/g, '[PATH_REDACTED]')
    .replace(/[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']+/g, '[PATH_REDACTED]')
    .replace(/(^|[,:;=\s"'([])\/(?!\/)[^\s"')]+/g, '$1[PATH_REDACTED]');
}

function supportBundleFilename(request: SupportBundleRequest, now: Date) {
  const raw = `neuma-support-${request.mode}-${request.ownerKey}-${request.runId}-${now.toISOString().slice(0, 10)}`;
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
  return `${safe}.zip`;
}

function validateLimits(limits: SupportBundleLimits) {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 64) {
      throw new Error('Support bundle limits must be positive integers');
    }
  }
}

function addOmissionsEntry(
  entries: Map<string, Buffer>,
  omissions: Omission[],
  limits: SupportBundleLimits,
  getTotal: () => number,
  addTotal: (size: number) => void,
) {
  if (omissions.length === 0) return;
  const data = boundedOmissionIndex(omissions, limits.maxEntryBytes);
  if (getTotal() + data.byteLength > limits.maxTotalBytes) return;
  entries.set('omissions.json', data);
  addTotal(data.byteLength);
}

function boundedOmissionIndex(omissions: Omission[], maxBytes: number) {
  const full = Buffer.from(JSON.stringify(omissions, null, 2));
  if (full.byteLength <= maxBytes) return full;
  const summary = Buffer.from(
    JSON.stringify({
      type: 'OMITTED_OVERSIZED_OMISSION_INDEX',
      count: omissions.length,
    }),
  );
  if (summary.byteLength > maxBytes) {
    throw new Error('Support bundle entry size limit is too small');
  }
  return summary;
}

async function generateZip(entries: Map<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of entries) zip.file(name, data);
  const generated = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return Buffer.from(generated);
}
