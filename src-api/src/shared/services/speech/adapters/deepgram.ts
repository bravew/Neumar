/**
 * Deepgram Speech Adapter
 *
 * Implements streaming STT via Deepgram Nova-3 + Flux and TTS via Aura-2.
 * Uses the Deepgram REST API for batch transcription and synthesis, and a
 * WebSocket connection for live streaming STT.
 *
 * @module speech/adapters/deepgram
 */

import WebSocket from 'ws';

import { createLogger } from '@/shared/utils/logger';

import type {
  SpeechAdapter,
  SpeechProviderConfig,
  StreamingSTTConfig,
  StreamingSTTSession,
  STTParams,
  STTResult,
  TTSParams,
  TTSResult,
  VoiceInfo,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const DEEPGRAM_API_BASE = 'https://api.deepgram.com/v1';
const DEEPGRAM_WS_BASE = 'wss://api.deepgram.com/v1';

const STT_MODEL = 'nova-3';
const TTS_MODEL = 'aura-2-en';
const TTS_ENCODING = 'mp3';

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;
const ENDPOINTING_MS = 300;
const UTTERANCE_END_MS = 1000;

const AURA_2_VOICES: VoiceInfo[] = [
  // English
  {
    id: 'aura-2-en',
    name: 'Aura 2 English',
    language: 'en',
    gender: 'neutral',
    provider: 'Deepgram',
  },
  {
    id: 'aura-2-thalia-en',
    name: 'Aura 2 Thalia',
    language: 'en',
    gender: 'female',
    provider: 'Deepgram',
  },
  {
    id: 'aura-2-orion-en',
    name: 'Aura 2 Orion',
    language: 'en',
    gender: 'male',
    provider: 'Deepgram',
  },
  {
    id: 'aura-2-luna-en',
    name: 'Aura 2 Luna',
    language: 'en',
    gender: 'female',
    provider: 'Deepgram',
  },
  {
    id: 'aura-2-asteria-en',
    name: 'Aura 2 Asteria',
    language: 'en',
    gender: 'female',
    provider: 'Deepgram',
  },
  // French
  {
    id: 'aura-2-agathe-fr',
    name: 'Aura 2 Agathe',
    language: 'fr',
    gender: 'female',
    provider: 'Deepgram',
  },
  {
    id: 'aura-2-angele-fr',
    name: 'Aura 2 Angèle',
    language: 'fr',
    gender: 'female',
    provider: 'Deepgram',
  },
  // Spanish
  {
    id: 'aura-2-celeste-es',
    name: 'Aura 2 Celeste',
    language: 'es',
    gender: 'female',
    provider: 'Deepgram',
  },
  {
    id: 'aura-2-paloma-es',
    name: 'Aura 2 Paloma',
    language: 'es',
    gender: 'female',
    provider: 'Deepgram',
  },
  {
    id: 'aura-2-emilio-es',
    name: 'Aura 2 Emilio',
    language: 'es',
    gender: 'male',
    provider: 'Deepgram',
  },
];

// ============================================================================
// Deepgram Response Shapes
// ============================================================================

interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
      }>;
    }>;
  };
  metadata?: {
    duration?: number;
    detected_language?: string;
  };
}

interface DeepgramStreamMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
}

// ============================================================================
// Adapter Implementation
// ============================================================================

const logger = createLogger('DeepgramSpeech');

export class DeepgramSpeechAdapter implements SpeechAdapter {
  readonly name = 'Deepgram';
  readonly dataEgress = 'cloud';
  readonly supportsTTS = true;
  readonly supportsSTT = true;
  readonly supportsStreamingSTT = true;
  readonly supportsStreamingTTS = false;

  private readonly config: SpeechProviderConfig;

  constructor(config: SpeechProviderConfig) {
    this.config = config;
  }

  // --------------------------------------------------------------------------
  // STT — Batch
  // --------------------------------------------------------------------------

  async transcribe(params: STTParams): Promise<STTResult> {
    const model = params.model ?? STT_MODEL;
    const url = new URL(`${DEEPGRAM_API_BASE}/listen`);
    url.searchParams.set('model', model);
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');
    if (params.language) {
      url.searchParams.set('language', params.language);
    }

    logger.debug('transcribe: sending audio to Deepgram', {
      model,
      mimeType: params.mimeType,
      language: params.language,
      bytes: params.audioData.byteLength,
    });

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          'Content-Type': params.mimeType ?? 'audio/wav',
        },
        body: new Uint8Array(params.audioData),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('transcribe: network error', { message });
      return { success: false, provider: this.name, model, error: message };
    }

    if (!response.ok) {
      const body = await response.text().catch((err: unknown) => {
        logger.warn('Failed to read error response body', {
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      });
      logger.error('transcribe: Deepgram API error', {
        status: response.status,
        body,
      });
      return {
        success: false,
        provider: this.name,
        model,
        error: `Deepgram API error ${response.status}: ${body}`,
      };
    }

    let data: DeepgramListenResponse;
    try {
      data = (await response.json()) as DeepgramListenResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('transcribe: failed to parse response JSON', { message });
      return {
        success: false,
        provider: this.name,
        model,
        error: `Failed to parse Deepgram response: ${message}`,
      };
    }

    const transcript =
      data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    const duration = data.metadata?.duration;
    const detectedLanguage = data.metadata?.detected_language;

    logger.debug('transcribe: success', {
      chars: transcript.length,
      duration,
      detectedLanguage,
    });

    return {
      success: true,
      provider: this.name,
      model,
      text: transcript,
      duration,
      detectedLanguage,
    };
  }

  // --------------------------------------------------------------------------
  // STT — Streaming
  // --------------------------------------------------------------------------

  transcribeStream(config: StreamingSTTConfig): StreamingSTTSession {
    const model = config.model ?? STT_MODEL;
    const sampleRate = config.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const channels = config.channels ?? DEFAULT_CHANNELS;

    const url = new URL(`${DEEPGRAM_WS_BASE}/listen`);
    url.searchParams.set('model', model);
    url.searchParams.set('encoding', config.encoding ?? 'linear16');
    url.searchParams.set('sample_rate', String(sampleRate));
    url.searchParams.set('channels', String(channels));
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('endpointing', String(ENDPOINTING_MS));
    url.searchParams.set('vad_events', 'true');
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('utterance_end_ms', String(UTTERANCE_END_MS));
    if (config.language) {
      url.searchParams.set('language', config.language);
    }

    logger.debug('transcribeStream: opening WebSocket', {
      model,
      sampleRate,
      channels,
      language: config.language,
    });

    const ws = new WebSocket(url.toString(), {
      headers: { Authorization: `Token ${this.config.apiKey}` },
    });

    // Callback storage
    let partialCb: ((text: string) => void) | null = null;
    let finalCb: ((text: string) => void) | null = null;
    let endOfTurnCb: (() => void) | null = null;
    let vadStartCb: (() => void) | null = null;
    let vadEndCb: (() => void) | null = null;
    let errorCb: ((error: Error) => void) | null = null;

    ws.on('open', () => {
      logger.debug('transcribeStream: WebSocket opened');
    });

    ws.on('message', (data: WebSocket.RawData) => {
      let msg: DeepgramStreamMessage;
      try {
        msg = JSON.parse(data.toString()) as DeepgramStreamMessage;
      } catch {
        logger.debug('transcribeStream: received non-JSON message, ignoring');
        return;
      }

      const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';

      // VAD events
      if (msg.type === 'SpeechStarted') {
        logger.debug('transcribeStream: VAD speech started');
        vadStartCb?.();
        return;
      }

      if (msg.type === 'UtteranceEnd') {
        logger.debug('transcribeStream: UtteranceEnd received');
        vadEndCb?.();
        endOfTurnCb?.();
        return;
      }

      // Transcript events
      if (msg.is_final === false) {
        // Interim / partial result
        if (transcript) {
          logger.debug('transcribeStream: partial transcript', {
            chars: transcript.length,
          });
          partialCb?.(transcript);
        }
        return;
      }

      if (msg.is_final === true) {
        // Final transcript for this utterance chunk
        if (transcript) {
          logger.debug('transcribeStream: final transcript', {
            chars: transcript.length,
            speechFinal: msg.speech_final,
          });
          finalCb?.(transcript);
        }

        // speech_final=true can also signal end of utterance
        if (msg.speech_final) {
          logger.debug(
            'transcribeStream: speech_final, signalling end of turn',
          );
          endOfTurnCb?.();
        }
      }
    });

    ws.on('error', (err: Error) => {
      logger.error('transcribeStream: WebSocket error', {
        message: err.message,
      });
      ws.removeAllListeners();
      errorCb?.(err);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      logger.debug('transcribeStream: WebSocket closed', {
        code,
        reason: reason.toString(),
      });
      ws.removeAllListeners();
    });

    const session: StreamingSTTSession = {
      sendAudio(chunk: Buffer): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        } else {
          logger.debug('transcribeStream: sendAudio called but WS not open', {
            readyState: ws.readyState,
          });
        }
      },

      onPartial(cb: (text: string) => void): void {
        partialCb = cb;
      },

      onFinal(cb: (text: string) => void): void {
        finalCb = cb;
      },

      onEndOfTurn(cb: () => void): void {
        endOfTurnCb = cb;
      },

      onVADStart(cb: () => void): void {
        vadStartCb = cb;
      },

      onVADEnd(cb: () => void): void {
        vadEndCb = cb;
      },

      onError(cb: (error: Error) => void): void {
        errorCb = cb;
      },

      close(): void {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'CloseStream' }));
          } catch (err) {
            logger.debug('transcribeStream: error sending CloseStream', {
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
        ws.close();
        logger.debug('transcribeStream: session closed');
      },
    };

    return session;
  }

  // --------------------------------------------------------------------------
  // TTS — Batch
  // --------------------------------------------------------------------------

  async synthesize(params: TTSParams): Promise<TTSResult> {
    const model = params.model ?? TTS_MODEL;
    const url = new URL(`${DEEPGRAM_API_BASE}/speak`);
    url.searchParams.set('model', model);
    url.searchParams.set('encoding', TTS_ENCODING);

    logger.debug('synthesize: sending TTS request to Deepgram', {
      model,
      textLength: params.text.length,
    });

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: params.text }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('synthesize: network error', { message });
      return { success: false, provider: this.name, model, error: message };
    }

    if (!response.ok) {
      const body = await response.text().catch((err: unknown) => {
        logger.warn('Failed to read error response body', {
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      });
      logger.error('synthesize: Deepgram API error', {
        status: response.status,
        body,
      });
      return {
        success: false,
        provider: this.name,
        model,
        error: `Deepgram TTS API error ${response.status}: ${body}`,
      };
    }

    let audioBuffer: Buffer;
    try {
      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('synthesize: failed to read response body', { message });
      return {
        success: false,
        provider: this.name,
        model,
        error: `Failed to read Deepgram TTS response: ${message}`,
      };
    }

    logger.debug('synthesize: success', { bytes: audioBuffer.byteLength });

    return {
      success: true,
      provider: this.name,
      model,
      audioData: audioBuffer,
      format: TTS_ENCODING,
    };
  }

  // --------------------------------------------------------------------------
  // Voice Listing
  // --------------------------------------------------------------------------

  async listVoices(): Promise<VoiceInfo[]> {
    return AURA_2_VOICES;
  }
}
