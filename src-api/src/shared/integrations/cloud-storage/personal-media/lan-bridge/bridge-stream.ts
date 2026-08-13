import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';

import type { BridgeResolution } from './types';

export class BridgeStreamError extends Error {
  constructor(
    message: string,
    public readonly code: 'REMOTE_REQUIRED' | 'LOCAL_STREAM_FAILED',
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'BridgeStreamError';
  }
}

export function openBridgeStream(
  resolution: BridgeResolution,
): ReadableStream<Uint8Array> {
  if (resolution.kind !== 'local') {
    throw new BridgeStreamError(
      `Remote content required: ${resolution.reason}`,
      'REMOTE_REQUIRED',
    );
  }

  const stream = createReadStream(resolution.absolutePath);
  stream.once('error', (error) => {
    stream.destroy(
      new BridgeStreamError(
        `Failed to read local bridge file: ${error.message}`,
        'LOCAL_STREAM_FAILED',
        error,
      ),
    );
  });
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export interface BridgeResponseOptions {
  range?: string;
  contentType?: string;
}

export async function openBridgeResponse(
  resolution: BridgeResolution,
  options: BridgeResponseOptions = {},
): Promise<Response> {
  if (resolution.kind !== 'local') {
    throw new BridgeStreamError(
      `Remote content required: ${resolution.reason}`,
      'REMOTE_REQUIRED',
    );
  }

  const fileStat = await stat(resolution.absolutePath);
  const totalSize = fileStat.size;
  const contentType = options.contentType ?? 'application/octet-stream';
  const range = parseRangeHeader(options.range, totalSize);

  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? totalSize - 1;
  const length = end - start + 1;
  const stream = createReadStream(resolution.absolutePath, { start, end });
  stream.once('error', (error) => {
    stream.destroy(
      new BridgeStreamError(
        `Failed to read local bridge file: ${error.message}`,
        'LOCAL_STREAM_FAILED',
        error,
      ),
    );
  });

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
  };
  let status = 200;
  if (range) {
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
  }

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status,
    headers,
  });
}

type ParsedRange = { start: number; end: number } | 'invalid' | undefined;

function parseRangeHeader(
  value: string | undefined,
  totalSize: number,
): ParsedRange {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return 'invalid';
  const startStr = match[1];
  const endStr = match[2];

  let start: number;
  let end: number;
  if (startStr === '' && endStr === '') return 'invalid';
  if (startStr === '') {
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? totalSize - 1 : Number(endStr);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
    if (start < 0 || end < start || start >= totalSize) return 'invalid';
    end = Math.min(end, totalSize - 1);
  }
  return { start, end };
}
