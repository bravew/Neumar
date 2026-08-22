import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runFFmpeg } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('VideoInlineImage');

/**
 * Cap for an image returned inside a tool result. Base64 inflates by ~4/3, so
 * this is the *encoded* budget; anything larger is downscaled once and then
 * dropped rather than blowing up the turn.
 */
const MAX_INLINE_BASE64_BYTES = 3_500_000;
const DOWNSCALE_MAX_EDGE_PX = 1400;

export interface InlineImage {
  base64: string;
  mimeType: 'image/png';
  bytes: number;
  downscaled: boolean;
}

/**
 * Read a PNG for inline return in an MCP tool result, downscaling once if the
 * encoded payload would be oversized. Returns `null` when it still does not
 * fit — callers keep the on-disk path in their text result either way.
 */
export async function readInlinePng(
  absolutePath: string,
): Promise<InlineImage | null> {
  const raw = await fs.readFile(absolutePath);
  if (encodedSize(raw.byteLength) <= MAX_INLINE_BASE64_BYTES) {
    return {
      base64: raw.toString('base64'),
      mimeType: 'image/png',
      bytes: raw.byteLength,
      downscaled: false,
    };
  }

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-inline-'));
  const scaledPath = path.join(scratch, 'scaled.png');
  try {
    const result = await runFFmpeg([
      '-y',
      '-i',
      absolutePath,
      '-vf',
      `scale='min(${DOWNSCALE_MAX_EDGE_PX},iw)':-2`,
      scaledPath,
    ]);
    if (result.exitCode !== 0) {
      logger.warn(`inline downscale failed: ${result.stderr.slice(0, 300)}`);
      return null;
    }
    const scaled = await fs.readFile(scaledPath);
    if (encodedSize(scaled.byteLength) > MAX_INLINE_BASE64_BYTES) return null;
    return {
      base64: scaled.toString('base64'),
      mimeType: 'image/png',
      bytes: scaled.byteLength,
      downscaled: true,
    };
  } catch (error) {
    logger.warn(
      `inline downscale unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

function encodedSize(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}
