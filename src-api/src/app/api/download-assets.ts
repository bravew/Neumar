import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { DownloadMediaOperation } from '@neumar/video-ir';
import { Hono } from 'hono';

import {
  getDownloadAsset,
  openDownloadFile,
} from '@/shared/services/media-download/assets';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DownloadAssets');

/** The scope a destination grant was issued for; resolves to its folder. */
export type DownloadScope = Pick<
  DownloadMediaOperation,
  'taskId' | 'runId' | 'toolCallId' | 'batchId' | 'destinationGrantId'
>;
export type ResolveDownloadDestination = (
  scope: DownloadScope,
) => Promise<string>;

type ByteRange = { start: number; end: number } | 'unsatisfiable';

/** One `bytes=a-b`, `bytes=a-` or `bytes=-n` range; anything else is refused. */
function parseRange(header: string, size: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return 'unsatisfiable';
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  return start >= size || start > end ? 'unsatisfiable' : { start, end };
}

/**
 * Task-scoped playback of saved downloads, by asset id.
 *
 * GET /tasks/:taskId/downloads/:assetId
 *
 * The caller never supplies a path. The route looks the asset up under the
 * task, re-resolves that task's destination grant, and serves the file only if
 * it is still the file that was registered inside the granted folder. Every
 * failure (unknown asset, another task's asset, revoked grant, moved or
 * replaced file) answers 404 so a probe learns nothing about the host.
 */
export function downloadAssetRoutes(
  resolveDestination: ResolveDownloadDestination,
): Hono {
  const app = new Hono();

  app.get('/tasks/:taskId/downloads/:assetId', async (c) => {
    const record = getDownloadAsset(
      c.req.param('taskId'),
      c.req.param('assetId'),
    );
    if (!record) return c.json({ error: 'Not found' }, 404);

    // The handle is the file that passed the identity check; every response
    // reads it, never the path again. A stream closes it when it ends.
    let file: { handle: FileHandle; size: number };
    try {
      const folder = await resolveDestination({
        taskId: record.taskId,
        runId: record.runId,
        toolCallId: record.toolCallId,
        batchId: record.batchId,
        destinationGrantId: record.grantId,
      });
      file = await openDownloadFile(record, folder);
    } catch (err) {
      logger.warn(
        `Download ${record.assetId} not served: ${err instanceof Error ? err.message : String(err)}`,
      );
      return c.json({ error: 'Not found' }, 404);
    }

    try {
      const headers: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Content-Type': record.mime,
        'Cache-Control': 'private, no-cache',
      };
      const rangeHeader = c.req.header('Range');
      if (rangeHeader) {
        const range = parseRange(rangeHeader, file.size);
        if (range === 'unsatisfiable') {
          await file.handle.close();
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${file.size}` },
          });
        }
        return new Response(
          Readable.toWeb(
            file.handle.createReadStream({
              start: range.start,
              end: range.end,
            }),
          ) as ReadableStream,
          {
            status: 206,
            headers: {
              ...headers,
              'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
              'Content-Length': String(range.end - range.start + 1),
            },
          },
        );
      }
      return new Response(
        Readable.toWeb(file.handle.createReadStream()) as ReadableStream,
        {
          status: 200,
          headers: { ...headers, 'Content-Length': String(file.size) },
        },
      );
    } catch (err) {
      await file.handle.close();
      throw err;
    }
  });

  return app;
}
