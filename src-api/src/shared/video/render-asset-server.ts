import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export interface RenderAssetClip {
  sourcePath: string;
  src: string;
}

export interface RenderAssetServer<TInput> {
  inputProps: TInput;
  close: () => Promise<void>;
}

interface RenderAssetServerInput {
  audioClips: RenderAssetClip[];
  captions?: unknown[];
  visualClips: RenderAssetClip[];
}

export async function startRenderAssetServer<
  TInput extends RenderAssetServerInput,
>(inputProps: TInput): Promise<RenderAssetServer<TInput>> {
  const renderInputProps = cloneRenderInput(inputProps);
  const clips = [
    ...renderInputProps.visualClips,
    ...renderInputProps.audioClips,
  ];
  if (clips.length === 0) {
    return { inputProps: renderInputProps, close: async () => {} };
  }

  const assets = new Map<string, { sourcePath: string; contentType: string }>();
  const idBySourcePath = new Map<string, string>();
  for (const clip of clips) {
    let id = idBySourcePath.get(clip.sourcePath);
    if (!id) {
      id = createHash('sha1')
        .update(clip.sourcePath)
        .digest('hex')
        .slice(0, 16);
      idBySourcePath.set(clip.sourcePath, id);
      assets.set(id, {
        sourcePath: clip.sourcePath,
        contentType: contentTypeForPath(clip.sourcePath),
      });
    }
  }

  const server = createServer((request, response) => {
    void serveRenderAsset({ assets, request, response }).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500).end();
        return;
      }
      response.destroy();
    });
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  for (const clip of clips) {
    const id = idBySourcePath.get(clip.sourcePath);
    if (!id) continue;
    clip.src = `${origin}/${id}/${encodeURIComponent(path.basename(clip.sourcePath))}`;
  }

  return {
    inputProps: renderInputProps,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function cloneRenderInput<TInput extends RenderAssetServerInput>(
  inputProps: TInput,
): TInput {
  return {
    ...inputProps,
    audioClips: inputProps.audioClips.map((clip) => ({ ...clip })),
    captions: inputProps.captions?.map(cloneCaption),
    visualClips: inputProps.visualClips.map((clip) => ({ ...clip })),
  } as TInput;
}

function cloneCaption(caption: unknown): unknown {
  if (!caption || typeof caption !== 'object') return caption;
  const clone = { ...caption } as Record<string, unknown>;
  const words = clone.words;
  if (Array.isArray(words)) {
    clone.words = words.map((word) =>
      word && typeof word === 'object' ? { ...word } : word,
    );
  }
  return clone;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

async function serveRenderAsset({
  assets,
  request,
  response,
}: {
  assets: Map<string, { sourcePath: string; contentType: string }>;
  request: IncomingMessage;
  response: import('node:http').ServerResponse;
}): Promise<void> {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, corsHeaders()).end();
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const id = url.pathname.split('/').filter(Boolean)[0];
  const asset = id ? assets.get(id) : undefined;
  if (!asset) {
    response.writeHead(404, corsHeaders()).end();
    return;
  }

  const stats = await fs.stat(asset.sourcePath);
  const range = parseByteRange(request.headers.range, stats.size);
  if (range === 'invalid') {
    response.writeHead(416, {
      ...corsHeaders(),
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${stats.size}`,
    });
    response.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, stats.size - 1);
  const contentLength = Math.max(0, end - start + 1);
  response.writeHead(range ? 206 : 200, {
    ...corsHeaders(),
    'Accept-Ranges': 'bytes',
    'Content-Length': String(contentLength),
    'Content-Type': asset.contentType,
    ...(range
      ? { 'Content-Range': `bytes ${start}-${end}/${stats.size}` }
      : {}),
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(asset.sourcePath, { start, end })
    .on('error', () => response.destroy())
    .pipe(response);
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  };
}

function parseByteRange(
  rangeHeader: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return 'invalid';
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'invalid';
  let start = rawStart ? Number(rawStart) : size - Number(rawEnd);
  let end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  start = Math.max(0, Math.floor(start));
  end = Math.min(size - 1, Math.floor(end));
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apng':
      return 'image/apng';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.ogg':
    case '.ogv':
      return 'video/ogg';
    case '.png':
      return 'image/png';
    case '.wav':
      return 'audio/wav';
    case '.webm':
      return 'video/webm';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
