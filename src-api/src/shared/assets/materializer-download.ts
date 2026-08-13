import fs from 'node:fs/promises';

import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';

import {
  appendResponseBody,
  numberHeader,
  sha256File,
  writeResponseBody,
} from './materializer-helpers';
import type { MaterializeRequest } from './materializer-types';
import { AssetsError } from './registry';
import type { Asset } from './types';

const RANGE_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const rangeSupportBySource = new Map<string, boolean>();

export interface DownloadedAssetBytes {
  bytes: number;
  contentHash: string;
  mime: string;
}

export async function downloadAssetToPartial(
  adapter: CloudStorageAdapter,
  asset: Asset,
  req: MaterializeRequest,
  partial: string,
  opts: {
    rangeMinBytes: number;
    onProgress: (bytes: number, total: number | null) => void;
  },
): Promise<DownloadedAssetBytes> {
  if (
    asset.bytes >= opts.rangeMinBytes &&
    rangeSupportBySource.get(rangeSupportKey(asset)) !== false
  ) {
    const ranged = await downloadRangeToPartial(
      adapter,
      asset,
      req,
      partial,
      opts,
    );
    if (ranged) return ranged;
  }
  return downloadWholeToPartial(adapter, asset, req, partial, opts);
}

async function downloadWholeToPartial(
  adapter: CloudStorageAdapter,
  asset: Asset,
  req: MaterializeRequest,
  partial: string,
  opts: { onProgress: (bytes: number, total: number | null) => void },
): Promise<DownloadedAssetBytes> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    req.signal?.throwIfAborted();
    await fs.rm(partial, { force: true }).catch(() => {});
    const response = await downloadWithRetry(adapter, asset, req);
    try {
      const total = numberHeader(response.headers.get('content-length'));
      const written = await writeResponseBody(response, partial, {
        total,
        signal: req.signal,
        onProgress: (bytes, totalBytes) =>
          opts.onProgress(bytes, totalBytes ?? asset.bytes),
      });
      return {
        ...written,
        mime: response.headers.get('content-type') ?? asset.mime,
      };
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      if (req.signal?.aborted || isAbortError(error)) throw error;
      if (!isRetryableDownloadError(error)) throw error;
      lastError = error;
      if (attempt === MAX_DOWNLOAD_ATTEMPTS) break;
      await delay(retryDelayMs(null, attempt), req.signal);
    }
  }
  throw downloadStreamError(lastError);
}

async function downloadRangeToPartial(
  adapter: CloudStorageAdapter,
  asset: Asset,
  req: MaterializeRequest,
  partial: string,
  opts: { onProgress: (bytes: number, total: number | null) => void },
): Promise<DownloadedAssetBytes | null> {
  if (asset.bytes <= 0 || !asset.sourceId) return null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    req.signal?.throwIfAborted();
    await fs.rm(partial, { force: true }).catch(() => {});
    try {
      return await downloadRangeToPartialOnce(
        adapter,
        asset,
        req,
        partial,
        opts,
      );
    } catch (error) {
      await fs.rm(partial, { force: true }).catch(() => {});
      if (req.signal?.aborted || isAbortError(error)) throw error;
      if (!isRetryableDownloadError(error)) throw error;
      lastError = error;
      if (attempt === MAX_DOWNLOAD_ATTEMPTS) break;
      await delay(retryDelayMs(null, attempt), req.signal);
    }
  }
  throw downloadStreamError(lastError);
}

async function downloadRangeToPartialOnce(
  adapter: CloudStorageAdapter,
  asset: Asset,
  req: MaterializeRequest,
  partial: string,
  opts: { onProgress: (bytes: number, total: number | null) => void },
): Promise<DownloadedAssetBytes | null> {
  let offset = 0;
  let mime = asset.mime;
  while (offset < asset.bytes) {
    const end = Math.min(offset + RANGE_CHUNK_BYTES - 1, asset.bytes - 1);
    const response = await downloadWithRetry(adapter, asset, req, {
      range: `bytes=${offset}-${end}`,
    });
    if (response.status !== 206) {
      rangeSupportBySource.set(rangeSupportKey(asset), false);
      await response.body?.cancel().catch(() => {});
      await fs.rm(partial, { force: true }).catch(() => {});
      return null;
    }
    mime = response.headers.get('content-type') ?? mime;
    const written = await appendResponseBody(response, partial, {
      total: asset.bytes,
      startBytes: offset,
      signal: req.signal,
      onProgress: opts.onProgress,
    });
    if (written.bytes <= 0) {
      throw new AssetsError('Asset connector returned an empty range', 502);
    }
    offset += written.bytes;
  }
  rangeSupportBySource.set(rangeSupportKey(asset), true);
  return { bytes: offset, contentHash: await sha256File(partial), mime };
}

export function __resetAssetDownloadCapabilitiesForTests(): void {
  rangeSupportBySource.clear();
}

function rangeSupportKey(asset: Asset): string {
  return `${asset.source}:${asset.connectionId ?? ''}`;
}

async function downloadWithRetry(
  adapter: CloudStorageAdapter,
  asset: Asset,
  req: MaterializeRequest,
  init: { range?: string } = {},
): Promise<Response> {
  let lastStatus = 502;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    req.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await adapter.download(asset.sourceId!, {
        signal: req.signal,
        range: init.range,
        // Materialization copies the master into the project for editing and
        // rendering — never a lossy streaming transcode.
        preferOriginal: true,
      });
    } catch (error) {
      if (req.signal?.aborted || isAbortError(error)) throw error;
      lastError = error;
      if (attempt === MAX_DOWNLOAD_ATTEMPTS) break;
      await delay(retryDelayMs(null, attempt), req.signal);
      continue;
    }
    if (response.ok) return response;
    lastStatus = response.status;
    if (
      !isTransientStatus(response.status) ||
      attempt === MAX_DOWNLOAD_ATTEMPTS
    ) {
      throw new AssetsError(
        `Asset connector returned HTTP ${response.status}`,
        response.status >= 500 ? 502 : response.status,
      );
    }
    await response.body?.cancel().catch(() => {});
    await delay(
      retryDelayMs(response.headers.get('retry-after'), attempt),
      req.signal,
    );
  }
  if (lastError) {
    throw new AssetsError(
      lastError instanceof Error
        ? lastError.message
        : 'Asset connector download failed',
      502,
    );
  }
  throw new AssetsError(`Asset connector returned HTTP ${lastStatus}`, 502);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return Math.min(2 ** (attempt - 1) * 250, 2000);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message.toLowerCase().includes('aborted')))
  );
}

function isRetryableDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message.toLowerCase());
    const code = errorCode(current);
    if (
      code &&
      [
        'ECONNRESET',
        'EPIPE',
        'ERR_HTTP2_STREAM_ERROR',
        'ETIMEDOUT',
        'UND_ERR_BODY_TIMEOUT',
        'UND_ERR_SOCKET',
      ].includes(code)
    ) {
      return true;
    }
    current = current.cause;
  }
  return messages.some(
    (message) =>
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('premature close') ||
      message.includes('terminated'),
  );
}

function errorCode(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function downloadStreamError(error: unknown): AssetsError {
  return new AssetsError(
    error instanceof Error && error.message
      ? `Asset connector download stream interrupted: ${error.message}`
      : 'Asset connector download stream interrupted',
    502,
    { code: 'ASSET_DOWNLOAD_STREAM_INTERRUPTED' },
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
  }).finally(() => {
    if (abort) signal?.removeEventListener('abort', abort);
  });
}
