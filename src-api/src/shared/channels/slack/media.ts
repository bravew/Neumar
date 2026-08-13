/**
 * Slack Media Utilities
 *
 * Secure file download and voice message handling for inbound Slack messages.
 * Follows OpenClaw production patterns: SSRF hostname allowlist, size limits,
 * HTML auth page rejection, and video/* → audio/* MIME remapping for voice clips.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import { downloadWithRedirects } from '../_shared/media';
import type { VoiceMessageInfo } from '../types';

const logger = createLogger('SlackMedia');

/** Hostnames permitted for Slack file downloads */
const SLACK_HOST_ALLOWLIST = [
  'files.slack.com',
  'slack-files.com',
  'slack-edge.com',
  'slack.com',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Download a Slack-hosted file with bot token authorization.
 *
 * Security:
 *   - Only allows known Slack hostnames (SSRF protection)
 *   - Checks Content-Length and body size against MAX_FILE_SIZE
 *   - Rejects HTML responses (Slack auth pages instead of file content)
 */
export async function downloadSlackFile(
  url: string,
  botToken: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  try {
    const parsed = new URL(url);
    const isAllowed = SLACK_HOST_ALLOWLIST.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
    );
    if (!isAllowed) {
      logger.warn('Rejected non-Slack file URL', {
        hostname: parsed.hostname,
      });
      return null;
    }

    const res = await downloadWithRedirects(url, {
      auth: `Bearer ${botToken}`,
      hosts: SLACK_HOST_ALLOWLIST,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });

    if (!res.ok) {
      logger.warn('Slack file download failed', { status: res.status });
      return null;
    }

    // Reject HTML auth pages returned instead of file content
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      logger.warn('Slack returned HTML instead of file (possible auth issue)');
      return null;
    }

    const contentLength = Number(res.headers.get('content-length') ?? '0');
    if (contentLength > MAX_FILE_SIZE) {
      logger.warn(
        `File too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB`,
      );
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return null;
    }

    const mimeType =
      contentType.split(';')[0]?.trim() ?? 'application/octet-stream';
    const filename = parsed.pathname.split('/').pop() ?? 'file';
    return { buffer, mimeType, filename };
  } catch (err) {
    logger.error('Slack file download error', { err });
    return null;
  }
}

/**
 * Download a Slack voice clip (slack_audio subtype) to a temp file.
 *
 * Slack audio clips report video/* MIME (e.g. video/webm) because the
 * container format supports video. We remap to audio/* so the transcription
 * pipeline routes correctly.
 */
export async function downloadSlackVoice(
  file: {
    url_private_download?: string;
    mimetype?: string;
    duration_ms?: number;
    size?: number;
    name?: string;
  },
  botToken: string,
): Promise<VoiceMessageInfo | null> {
  if (!file.url_private_download) return null;

  const result = await downloadSlackFile(file.url_private_download, botToken);
  if (!result) return null;

  const tmpDir = path.join(os.tmpdir(), 'neuma-voice');
  await fs.mkdir(tmpDir, { recursive: true });
  const ext = path.extname(file.name ?? '') || '.webm';
  const filePath = path.join(
    tmpDir,
    `slack-voice-${crypto.randomUUID()}${ext}`,
  );
  await fs.writeFile(filePath, result.buffer);

  // Remap video/* → audio/* for transcription pipeline
  let mimeType = file.mimetype ?? result.mimeType;
  if (mimeType.startsWith('video/')) {
    mimeType = mimeType.replace('video/', 'audio/');
  }

  logger.info(
    `Downloaded Slack voice (${result.buffer.byteLength} bytes, ${mimeType})`,
  );

  return {
    filePath,
    mimeType,
    durationSecs: file.duration_ms ? file.duration_ms / 1000 : undefined,
    sizeBytes: result.buffer.byteLength,
  };
}
