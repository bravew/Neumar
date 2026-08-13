/**
 * Discord Voice Message Support
 *
 * Handles downloading incoming voice messages and sending voice messages
 * via Discord's voice message protocol (3-step upload flow).
 *
 * Voice messages require:
 * - OGG/Opus format audio at 48kHz
 * - Waveform data (base64 encoded, 256 samples, 0-255 values)
 * - Duration in seconds
 * - Message flag 8192 (IS_VOICE_MESSAGE)
 * - No text content (audio-only)
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DiscordVoice');

const DISCORD_VOICE_MESSAGE_FLAG = 1 << 13;
const WAVEFORM_SAMPLES = 256;
const MAX_VOICE_BYTES = 25 * 1024 * 1024; // 25 MB

export interface VoiceMessageMetadata {
  durationSecs: number;
  waveform: string; // base64 encoded
}

/**
 * Download a Discord voice message attachment to a temp file.
 * Returns the path to the downloaded OGG file.
 */
export async function downloadDiscordVoiceAttachment(
  url: string,
  originalName: string,
): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), 'neuma-voice');
  await fs.mkdir(tmpDir, { recursive: true });

  const ext = path.extname(originalName) || '.ogg';
  const filename = `voice-${crypto.randomUUID()}${ext}`;
  const filePath = path.join(tmpDir, filename);

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Failed to download voice attachment: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > MAX_VOICE_BYTES) {
    throw new Error(
      `Voice attachment too large (${Math.round(contentLength / 1024 / 1024)}MB > 25MB)`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_VOICE_BYTES) {
    throw new Error(
      `Voice attachment body too large (${Math.round(buffer.byteLength / 1024 / 1024)}MB > 25MB)`,
    );
  }
  await fs.writeFile(filePath, buffer);

  logger.info(
    `Downloaded voice message to ${filePath} (${buffer.length} bytes)`,
  );
  return filePath;
}

/**
 * Generate a placeholder waveform for voice messages.
 * Returns base64-encoded 256-byte array.
 */
function generatePlaceholderWaveform(): string {
  const waveform: number[] = [];
  for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
    const value = Math.round(
      128 + 64 * Math.sin((i / WAVEFORM_SAMPLES) * Math.PI * 8),
    );
    waveform.push(Math.min(255, Math.max(0, value)));
  }
  return Buffer.from(waveform).toString('base64');
}

/**
 * Send a voice message to a Discord channel.
 *
 * Follows Discord's 3-step voice message protocol:
 * 1. Request upload URL from Discord
 * 2. Upload the OGG file to the CDN
 * 3. Send message with flag 8192 and attachment metadata
 */
export async function sendDiscordVoiceMessage(
  botToken: string,
  channelId: string,
  audioFilePath: string,
  metadata?: Partial<VoiceMessageMetadata>,
  replyTo?: string,
): Promise<{ id: string; channel_id: string }> {
  const audioBuffer = await fs.readFile(audioFilePath);
  const filename = 'voice-message.ogg';
  const fileSize = audioBuffer.byteLength;

  const durationSecs = metadata?.durationSecs ?? 5;
  const waveform = metadata?.waveform ?? generatePlaceholderWaveform();

  const baseUrl = 'https://discord.com/api/v10';

  // Step 1: Request upload URL
  const uploadUrlRes = await fetch(
    `${baseUrl}/channels/${channelId}/attachments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: [{ filename, file_size: fileSize, id: '0' }],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!uploadUrlRes.ok) {
    const body = await uploadUrlRes.text();
    throw new Error(
      `Upload URL request failed: ${uploadUrlRes.status} ${body}`,
    );
  }

  const uploadUrlData = (await uploadUrlRes.json()) as {
    attachments: Array<{
      id: number;
      upload_url: string;
      upload_filename: string;
    }>;
  };

  const uploadInfo = uploadUrlData.attachments?.[0];
  if (!uploadInfo) {
    throw new Error('Failed to get upload URL for voice message');
  }

  // Step 2: Upload the audio to Discord's CDN
  const uploadRes = await fetch(uploadInfo.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/ogg' },
    body: new Uint8Array(audioBuffer),
    signal: AbortSignal.timeout(30_000),
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload voice message: ${uploadRes.status}`);
  }

  // Step 3: Send the message with voice flag
  const messagePayload: Record<string, unknown> = {
    flags: DISCORD_VOICE_MESSAGE_FLAG,
    attachments: [
      {
        id: '0',
        filename,
        uploaded_filename: uploadInfo.upload_filename,
        duration_secs: durationSecs,
        waveform,
      },
    ],
  };

  if (replyTo) {
    messagePayload.message_reference = {
      message_id: replyTo,
      fail_if_not_exists: false,
    };
  }

  const sendRes = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messagePayload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!sendRes.ok) {
    const body = await sendRes.text();
    throw new Error(`Failed to send voice message: ${sendRes.status} ${body}`);
  }

  const result = (await sendRes.json()) as { id: string; channel_id: string };
  logger.info(`Sent voice message ${result.id} to channel ${channelId}`);
  return result;
}
