/**
 * Voice Transcription — Gateway Middleware
 *
 * Transcribes inbound voice/audio messages from channels (Discord, Telegram,
 * Slack, etc.) using the speech service's STT pipeline before forwarding
 * the text to the agent.
 *
 * Flow: channel voice message → download audio → STT transcribe → text message
 *
 * Supports all STT providers configured in the speech service:
 * OpenAI Whisper, Deepgram, local SenseVoice, etc.
 */

import { access, readFile, stat, unlink } from 'node:fs/promises';

import { listCapabilities, transcribe } from '@/shared/services/speech';
import { createLogger } from '@/shared/utils/logger';

import type { InboundMessage, VoiceMetadata } from '../channels/types';
import type { GatewayConfig } from '../shared/config/types';

const logger = createLogger('VoiceTranscription');

/** Result of attempting voice transcription */
export interface TranscriptionResult {
  /** Whether transcription was attempted and succeeded */
  success: boolean;
  /** Transcribed text (empty string if failed) */
  text: string;
  /** Detected language (if provider supports it) */
  detectedLanguage?: string;
  /** Audio duration in seconds */
  durationSecs?: number;
  /** STT provider used */
  provider?: string;
  /** Error message if transcription failed */
  error?: string;
}

/**
 * Check whether STT is available (any provider configured).
 * Uses cached adapter discovery — cheap to call repeatedly.
 */
export function isSTTAvailable(): boolean {
  const caps = listCapabilities();
  return caps.sttProviders.length > 0;
}

/**
 * Transcribe a voice message's audio file to text.
 *
 * Reads the audio file from disk, sends it to the best available STT
 * provider, and returns the transcribed text.
 */
export async function transcribeVoiceMessage(
  voice: VoiceMetadata,
  config: GatewayConfig['voiceTranscription'],
): Promise<TranscriptionResult> {
  // Check file exists
  try {
    await access(voice.filePath);
  } catch {
    logger.error(`Voice file not found: ${voice.filePath}`);
    return { success: false, text: '', error: 'Audio file not found' };
  }

  // Check file size
  const fileStat = await stat(voice.filePath);
  if (fileStat.size > config.maxFileSizeBytes) {
    logger.warn(
      `Voice file too large (${fileStat.size} bytes > ${config.maxFileSizeBytes}), skipping transcription`,
    );
    return {
      success: false,
      text: '',
      error: `Audio file too large (${Math.round(fileStat.size / 1024 / 1024)}MB)`,
    };
  }

  if (fileStat.size === 0) {
    logger.warn('Voice file is empty, skipping transcription');
    return { success: false, text: '', error: 'Audio file is empty' };
  }

  // Read audio data
  const audioData = await readFile(voice.filePath);

  logger.info(
    `Transcribing voice message: ${voice.filePath} (${audioData.byteLength} bytes, ${voice.mimeType})`,
  );

  try {
    const result = await transcribe({
      audioData,
      mimeType: voice.mimeType,
      language: config.language || undefined,
      provider: config.preferredProvider || undefined,
    });

    if (!result.success || !result.text) {
      logger.warn(
        `STT transcription failed: ${result.error ?? 'no text returned'}`,
      );
      return {
        success: false,
        text: '',
        provider: result.provider,
        error: result.error ?? 'Transcription returned no text',
      };
    }

    logger.info(
      `Voice transcription complete: "${result.text.slice(0, 100)}${result.text.length > 100 ? '…' : ''}" ` +
        `(provider=${result.provider}, lang=${result.detectedLanguage ?? 'unknown'})`,
    );

    return {
      success: true,
      text: result.text,
      detectedLanguage: result.detectedLanguage,
      durationSecs: result.duration ?? voice.durationSecs,
      provider: result.provider,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`STT transcription error: ${msg}`);
    return { success: false, text: '', error: msg };
  }
}

/**
 * Process an inbound voice message: transcribe and convert to text.
 *
 * If STT is available and transcription succeeds, mutates the message:
 * - `content` becomes the transcribed text (prefixed with voice indicator)
 * - `contentType` becomes 'text'
 *
 * If STT is unavailable or fails, falls back to a placeholder text
 * indicating a voice message was received but couldn't be transcribed.
 *
 * Returns the (possibly mutated) message for continued pipeline processing.
 */
export async function processVoiceMessage(
  message: InboundMessage,
  config: GatewayConfig['voiceTranscription'],
): Promise<InboundMessage> {
  if (message.contentType !== 'voice' || !message.voice) {
    return message;
  }

  // Check if voice transcription is enabled
  if (!config.enabled) {
    logger.debug('Voice transcription disabled — forwarding as-is');
    return {
      ...message,
      content: '[Voice message received — transcription disabled]',
      contentType: 'text',
    };
  }

  // Check if any STT provider is available
  if (!isSTTAvailable()) {
    logger.warn(
      'No STT provider configured — voice message cannot be transcribed. ' +
        'Configure an STT model (e.g., OpenAI Whisper, Deepgram) in Settings → Models.',
    );
    return {
      ...message,
      content:
        '[Voice message received — no speech-to-text provider configured. ' +
        'Enable an STT model in Settings → Models to transcribe voice messages.]',
      contentType: 'text',
    };
  }

  // Transcribe
  const result = await transcribeVoiceMessage(message.voice, config);

  if (result.success && result.text) {
    return {
      ...message,
      content: result.text,
      contentType: 'text',
    };
  }

  // Transcription failed — include error context
  const fallback = result.error
    ? `[Voice message received — transcription failed: ${result.error}]`
    : '[Voice message received — transcription failed]';

  return {
    ...message,
    content: fallback,
    contentType: 'text',
  };
}

/**
 * Clean up temporary voice files after processing.
 * Called after the message has been fully handled to avoid
 * accumulating temp files from voice messages.
 */
export async function cleanupVoiceFile(voice: VoiceMetadata): Promise<void> {
  try {
    await unlink(voice.filePath);
    logger.debug(`Cleaned up voice temp file: ${voice.filePath}`);
  } catch (err) {
    // Non-critical: file will be cleaned up on next OS temp purge
    logger.debug(
      `Failed to clean up voice file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
