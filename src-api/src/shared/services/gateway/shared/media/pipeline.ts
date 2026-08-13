/**
 * Gateway Media Pipeline
 *
 * Processes outbound media files for channel delivery:
 * 1. Probe file to get metadata (size, format, duration)
 * 2. If under channel size limit → pass through as-is
 * 3. If video over limit → compress with FFmpeg to fit
 * 4. If still over limit → upload to CDN and return URL
 *
 * Follows openclaw pattern: native channel upload when possible,
 * CDN fallback only when necessary.
 */

import crypto from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectBinaries, probeFile, runFFmpeg } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import { uploadToCdn, type CdnConfig } from './cdn';

const logger = createLogger('MediaPipeline');

/** Per-channel size limits in bytes */
export interface ChannelMediaLimits {
  /** Max file size for direct upload (bytes) */
  maxUploadBytes: number;
  /** Max video duration for compression (seconds). Videos longer than this skip compression. */
  maxCompressDurationSecs: number;
}

/** Default limits per channel */
export const CHANNEL_LIMITS: Record<string, ChannelMediaLimits> = {
  discord: {
    maxUploadBytes: 25 * 1024 * 1024, // 25MB
    maxCompressDurationSecs: 300, // 5 min
  },
  telegram: {
    maxUploadBytes: 50 * 1024 * 1024, // 50MB (Bot API limit)
    maxCompressDurationSecs: 600, // 10 min
  },
  slack: {
    maxUploadBytes: 25 * 1024 * 1024,
    maxCompressDurationSecs: 300,
  },
};

const DEFAULT_LIMITS: ChannelMediaLimits = {
  maxUploadBytes: 25 * 1024 * 1024,
  maxCompressDurationSecs: 300,
};

export interface MediaResult {
  /** How the media should be delivered */
  delivery: 'file' | 'url';
  /** Local file path (for 'file' delivery) */
  filePath?: string;
  /** CDN URL (for 'url' delivery) */
  url?: string;
  /** MIME type */
  mimeType?: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Whether this is a temporary file that should be cleaned up */
  isTemp: boolean;
  /** Original file name */
  fileName: string;
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.flv',
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.m4a',
  '.aac',
]);

function isVideo(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isAudio(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Process a media file for outbound delivery on a specific channel.
 *
 * Strategy:
 * 1. If file is under the channel's upload limit → direct upload
 * 2. If file is a video over the limit → try FFmpeg compression
 * 3. If still over limit → upload to CDN (if configured) and return URL
 * 4. If no CDN → return error
 */
export async function processMediaForChannel(
  filePath: string,
  channelId: string,
  cdnConfig?: CdnConfig,
): Promise<MediaResult> {
  if (!existsSync(filePath)) {
    throw new Error(`Media file not found: ${filePath}`);
  }

  const stat = statSync(filePath);
  const limits = CHANNEL_LIMITS[channelId] ?? DEFAULT_LIMITS;
  const fileName = path.basename(filePath);

  // Step 1: Check if file fits within channel limits
  if (stat.size <= limits.maxUploadBytes) {
    logger.info(
      `File ${fileName} (${formatBytes(stat.size)}) fits within ${channelId} limit`,
    );
    return {
      delivery: 'file',
      filePath,
      sizeBytes: stat.size,
      isTemp: false,
      fileName,
    };
  }

  logger.info(
    `File ${fileName} (${formatBytes(stat.size)}) exceeds ${channelId} limit (${formatBytes(limits.maxUploadBytes)})`,
  );

  // Step 2: Try video compression if it's a video
  if (isVideo(filePath)) {
    const compressed = await tryCompressVideo(filePath, limits);
    if (compressed) {
      logger.info(
        `Compressed ${fileName} from ${formatBytes(stat.size)} to ${formatBytes(compressed.sizeBytes)}`,
      );
      return compressed;
    }
  }

  // Step 3: Try audio compression if it's audio
  if (isAudio(filePath)) {
    const compressed = await tryCompressAudio(filePath, limits);
    if (compressed) {
      return compressed;
    }
  }

  // Step 4: Upload to CDN if configured
  if (cdnConfig) {
    return uploadMediaToCdn(filePath, cdnConfig);
  }

  // Step 5: No CDN configured — try aggressive compression as last resort
  if (isVideo(filePath)) {
    const aggressive = await tryCompressVideo(filePath, limits, true);
    if (aggressive) {
      return aggressive;
    }
  }

  // Cannot deliver this file
  logger.warn(
    `Cannot deliver ${fileName} (${formatBytes(stat.size)}): exceeds limit and no CDN configured`,
  );
  throw new Error(
    `File too large (${formatBytes(stat.size)}). Max for ${channelId}: ${formatBytes(limits.maxUploadBytes)}`,
  );
}

/**
 * Try to compress a video file to fit within the channel size limit.
 * Uses two-pass approach: first try moderate compression, then aggressive.
 */
async function tryCompressVideo(
  filePath: string,
  limits: ChannelMediaLimits,
  aggressive = false,
): Promise<MediaResult | null> {
  const bins = detectBinaries();
  if (!bins) {
    logger.warn('FFmpeg not available — cannot compress video');
    return null;
  }

  // Probe the input to get duration
  const tmpDir = path.join(os.tmpdir(), 'neuma-channel-media');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(tmpDir, { recursive: true });

  let duration: number;
  try {
    const probe = await probeFile(filePath, path.dirname(filePath));
    duration = probe.duration;
  } catch {
    logger.warn('Could not probe video — skipping compression');
    return null;
  }

  if (duration <= 0) return null;
  if (duration > limits.maxCompressDurationSecs) {
    logger.info(`Video too long (${Math.round(duration)}s) for compression`);
    return null;
  }

  // Calculate target bitrate to fit within size limit
  // Formula: target_bytes * 8 / duration = bitrate in bits/s
  // Leave 5% headroom for container overhead
  const targetBytes = limits.maxUploadBytes * 0.95;
  const targetBitrate = Math.floor((targetBytes * 8) / duration);

  // Minimum quality threshold — don't compress below 200kbps
  const minBitrate = aggressive ? 150_000 : 300_000;
  if (targetBitrate < minBitrate) {
    logger.info(
      `Target bitrate too low (${Math.round(targetBitrate / 1000)}kbps) — skipping compression`,
    );
    return null;
  }

  const videoBitrate = Math.floor(targetBitrate * 0.9); // 90% for video
  const audioBitrate = Math.min(Math.floor(targetBitrate * 0.1), 128_000); // 10% for audio, max 128kbps

  const outputPath = path.join(tmpDir, `compressed-${crypto.randomUUID()}.mp4`);

  const args = [
    '-i',
    filePath,
    '-c:v',
    'libx264',
    '-preset',
    aggressive ? 'slower' : 'medium',
    '-b:v',
    `${videoBitrate}`,
    '-maxrate',
    `${Math.floor(videoBitrate * 1.5)}`,
    '-bufsize',
    `${Math.floor(videoBitrate * 2)}`,
    '-c:a',
    'aac',
    '-b:a',
    `${audioBitrate}`,
    // Scale down if aggressive mode
    ...(aggressive
      ? [
          '-vf',
          'scale=min(720\\,iw):min(720\\,ih):force_original_aspect_ratio=decrease',
        ]
      : []),
    '-movflags',
    '+faststart',
    outputPath,
  ];

  try {
    const { exitCode, stderr } = await runFFmpeg(args, {
      inputDuration: duration,
    });

    if (exitCode !== 0) {
      logger.warn(`Video compression failed: ${stderr.slice(-200)}`);
      return null;
    }

    if (!existsSync(outputPath)) return null;

    const outputStat = statSync(outputPath);
    if (outputStat.size > limits.maxUploadBytes) {
      // Compressed file still too large
      logger.info(
        `Compressed video still too large: ${formatBytes(outputStat.size)}`,
      );
      // Clean up temp file if not returning it
      if (!aggressive) {
        try {
          (await import('node:fs/promises')).unlink(outputPath).catch(() => {});
        } catch {}
      }
      return null;
    }

    return {
      delivery: 'file',
      filePath: outputPath,
      mimeType: 'video/mp4',
      sizeBytes: outputStat.size,
      isTemp: true,
      fileName: path.basename(filePath).replace(/\.[^.]+$/, '.mp4'),
    };
  } catch (err) {
    logger.warn('Video compression error', err);
    return null;
  }
}

/**
 * Try to compress an audio file to fit within channel limits.
 */
async function tryCompressAudio(
  filePath: string,
  limits: ChannelMediaLimits,
): Promise<MediaResult | null> {
  const bins = detectBinaries();
  if (!bins) return null;

  const tmpDir = path.join(os.tmpdir(), 'neuma-channel-media');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(tmpDir, { recursive: true });

  const outputPath = path.join(tmpDir, `compressed-${crypto.randomUUID()}.mp3`);

  const args = [
    '-i',
    filePath,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-ac',
    '2',
    outputPath,
  ];

  try {
    const { exitCode } = await runFFmpeg(args);
    if (exitCode !== 0) return null;
    if (!existsSync(outputPath)) return null;

    const stat = statSync(outputPath);
    if (stat.size > limits.maxUploadBytes) return null;

    return {
      delivery: 'file',
      filePath: outputPath,
      mimeType: 'audio/mpeg',
      sizeBytes: stat.size,
      isTemp: true,
      fileName: path.basename(filePath).replace(/\.[^.]+$/, '.mp3'),
    };
  } catch {
    return null;
  }
}

/**
 * Upload a media file to CDN and return the public URL.
 */
async function uploadMediaToCdn(
  filePath: string,
  cdnConfig: CdnConfig,
): Promise<MediaResult> {
  const stat = statSync(filePath);
  const fileName = path.basename(filePath);

  const url = await uploadToCdn(filePath, cdnConfig);

  logger.info(
    `Uploaded ${fileName} (${formatBytes(stat.size)}) to CDN: ${url}`,
  );

  return {
    delivery: 'url',
    url,
    sizeBytes: stat.size,
    isTemp: false,
    fileName,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
