import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

import { validatePath } from '@/shared/services/ffmpeg';
import {
  getProject,
  getVideoProjectDir,
  getVideoProjectRoot,
} from '@/shared/video/store';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export async function resolveReferenceArchiveFile(
  projectId: string,
  referenceId: string,
  relativePath: string,
): Promise<string> {
  const reference = (await getProject(projectId)).videoReferences?.find(
    (item) => item.id === referenceId,
  );
  if (!reference) throw new Error('Reference not found.');
  const absolute = path.join(getVideoProjectDir(projectId), relativePath);
  return validatePath(absolute, getVideoProjectRoot(projectId), 'read');
}

export function streamLocalMediaFile(
  filePath: string,
  rangeHeader: string | undefined,
): Response {
  const stat = statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) return new Response('Invalid Range header', { status: 416 });
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : fileSize - 1;
    if (start >= fileSize || end >= fileSize || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      });
    }
    return new Response(
      toWebStream(createReadStream(filePath, { start, end })),
      {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=60',
        },
      },
    );
  }
  return new Response(toWebStream(createReadStream(filePath)), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60',
    },
  });
}

function toWebStream(
  nodeStream: ReturnType<typeof createReadStream>,
): ReadableStream<Buffer> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}
