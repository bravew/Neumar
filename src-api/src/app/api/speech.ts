/**
 * Speech API Routes
 *
 * REST + WebSocket endpoints for TTS, STT, streaming STT,
 * voice management, voice cloning, and local model management.
 *
 * Routes:
 *   POST   /synthesize          — Batch TTS → binary audio
 *   POST   /transcribe          — Batch STT (multipart form) → JSON
 *   GET    /voices              — List available TTS voices
 *   GET    /capabilities        — List available providers + local model status
 *   GET    /local/status        — Local model download status
 *   POST   /local/download      — Trigger local model download
 *   POST   /voice-clone         — Upload WAV to create a cloned voice
 *   GET    /voice-clone         — List cloned voices
 *   DELETE /voice-clone/:name   — Delete a cloned voice
 *   POST   /voice-clone/test    — Test a cloned voice with sample text
 *
 * @module api/speech
 */

import { zValidator } from '@hono/zod-validator';
import { Hono, type Context, type Next } from 'hono';
import { z } from 'zod';

import {
  createStreamingSTTSession,
  deleteClonedVoice,
  downloadSTTModel,
  downloadTTSModel,
  getAllTTSModelStatuses,
  getSTTModelStatus,
  listCapabilities,
  listClonedVoices,
  listVoices,
  saveClonedVoice,
  synthesize,
  synthesizeStream,
  transcribe,
} from '@/shared/services/speech';
import type { StreamingSTTSession, TtsModelId } from '@/shared/services/speech';
import { createLogger } from '@/shared/utils/logger';
import { getUpgradeWebSocket } from '@/shared/ws';

const logger = createLogger('SpeechAPI');

export const speechRoutes = new Hono();

// ============================================================================
// Batch TTS — POST /synthesize
// ============================================================================

const TTS_TEXT_MAX_LEN = 10_000;

const synthesizeSchema = z.object({
  text: z.string().min(1).max(TTS_TEXT_MAX_LEN),
  voice: z.string().optional(),
  format: z.enum(['mp3', 'opus', 'wav', 'pcm', 'flac']).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
  language: z.string().optional(),
  languageBoost: z.string().optional(),
  model: z.string().optional(),
  instructions: z.string().optional(),
  provider: z.string().optional(),
});

const TTS_FORMATS = ['mp3', 'opus', 'wav', 'pcm', 'flac'] as const;
type TtsFormat = (typeof TTS_FORMATS)[number];

function parseTtsFormat(raw: string | undefined): TtsFormat {
  if (!raw) return 'pcm';
  return TTS_FORMATS.includes(raw as TtsFormat) ? (raw as TtsFormat) : 'pcm';
}

speechRoutes.post(
  '/synthesize',
  zValidator('json', synthesizeSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');

      logger.debug(
        `synthesize: text="${body.text.slice(0, 60)}…", voice=${body.voice ?? 'default'}, provider=${body.provider ?? 'auto'}`,
      );

      const result = await synthesize({
        text: body.text,
        voice: body.voice,
        format: body.format,
        speed: body.speed,
        language: body.language,
        languageBoost: body.languageBoost,
        model: body.model,
        instructions: body.instructions,
        provider: body.provider,
      });

      if (!result.success || !result.audioData) {
        return c.json(
          {
            success: false,
            error: result.error ?? 'Synthesis failed',
            provider: result.provider,
          },
          500,
        );
      }

      // Return binary audio with appropriate content type
      const contentTypeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        opus: 'audio/opus',
        wav: 'audio/wav',
        pcm: 'audio/pcm',
        flac: 'audio/flac',
      };
      const contentType =
        contentTypeMap[result.format ?? 'mp3'] ?? 'audio/mpeg';

      return new Response(new Uint8Array(result.audioData), {
        headers: {
          'Content-Type': contentType,
          'X-Speech-Provider': result.provider,
          'X-Speech-Model': result.model,
        },
      });
    } catch (error) {
      logger.error('synthesize error:', error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
);

// ============================================================================
// Streaming TTS — GET /synthesize/stream
// ============================================================================

speechRoutes.get('/synthesize/stream', async (c) => {
  try {
    const text = c.req.query('text');
    if (!text?.trim()) {
      return c.json({ success: false, error: 'Missing text query' }, 400);
    }
    if (text.length > TTS_TEXT_MAX_LEN) {
      return c.json(
        {
          success: false,
          error: `Text exceeds ${TTS_TEXT_MAX_LEN} character limit`,
        },
        413,
      );
    }

    const format = parseTtsFormat(c.req.query('format'));
    const speedRaw = c.req.query('speed');
    const speed = speedRaw ? Number(speedRaw) : undefined;
    const validSpeed =
      typeof speed === 'number' &&
      Number.isFinite(speed) &&
      speed >= 0.5 &&
      speed <= 2.0
        ? speed
        : undefined;

    const result = await synthesizeStream({
      text,
      voice: c.req.query('voice') || undefined,
      format,
      speed: validSpeed,
      language: c.req.query('language') || undefined,
      model: c.req.query('model') || undefined,
      instructions: c.req.query('instructions') || undefined,
      provider: c.req.query('provider') || undefined,
    });

    if (!result.success || !result.stream) {
      return c.json(
        { success: false, error: result.error ?? 'Synthesis failed' },
        500,
      );
    }

    const contentTypeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      opus: 'audio/opus',
      wav: 'audio/wav',
      pcm: 'audio/pcm',
      flac: 'audio/flac',
    };

    let bytesStreamed = 0;
    let chunkCount = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await result.stream!.next();
          if (next.done) {
            logger.info(
              `synthesize stream: complete (${chunkCount} chunks, ${bytesStreamed} bytes via ${result.provider}/${result.format})`,
            );
            controller.close();
            return;
          }
          // Copy bytes — Buffer.buffer is shared across pool allocations and
          // would leak unrelated data downstream if forwarded by reference.
          const chunk = Uint8Array.from(next.value);
          bytesStreamed += chunk.byteLength;
          chunkCount++;
          controller.enqueue(chunk);
        },
        async cancel(reason) {
          logger.warn(
            `synthesize stream: cancelled after ${chunkCount} chunks / ${bytesStreamed} bytes`,
            {
              reason: reason instanceof Error ? reason.message : String(reason),
            },
          );
          await result.stream?.return?.(undefined);
        },
      }),
      {
        headers: {
          'Content-Type': contentTypeMap[result.format] ?? 'audio/pcm',
          'X-Speech-Provider': result.provider,
          'X-Speech-Model': result.model,
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    logger.error('synthesize stream error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

// ============================================================================
// Batch STT — POST /transcribe
// ============================================================================

/** Maximum upload size for audio transcription (25 MB — matches OpenAI Whisper limit). */
const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

speechRoutes.post('/transcribe', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json(
        { success: false, error: 'Missing required file field' },
        400,
      );
    }

    if (file.size > MAX_TRANSCRIBE_BYTES) {
      return c.json(
        {
          success: false,
          error: `Audio file exceeds ${MAX_TRANSCRIBE_BYTES / (1024 * 1024)} MB limit`,
        },
        413,
      );
    }

    const language = formData.get('language') as string | null;
    const model = formData.get('model') as string | null;
    const timestamps = formData.get('timestamps') === 'true';
    const prompt = formData.get('prompt') as string | null;
    const provider = formData.get('provider') as string | null;

    logger.info(
      `transcribe: file=${file.name} (${file.size} bytes), provider=${provider ?? 'auto'}`,
    );

    const audioBuffer = Buffer.from(await file.arrayBuffer());

    const result = await transcribe({
      audioData: audioBuffer,
      mimeType: file.type || undefined,
      language: language || undefined,
      model: model || undefined,
      timestamps,
      prompt: prompt || undefined,
      provider: provider || undefined,
    });

    return c.json(result);
  } catch (error) {
    logger.error('transcribe error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

// ============================================================================
// Voices — GET /voices
// ============================================================================

speechRoutes.get('/voices', async (c) => {
  try {
    const provider = c.req.query('provider');
    const voices = await listVoices(provider);
    return c.json({ voices });
  } catch (error) {
    logger.error('listVoices error:', error);
    return c.json({ error: String(error), voices: [] }, 500);
  }
});

// ============================================================================
// Capabilities — GET /capabilities
// ============================================================================

speechRoutes.get('/capabilities', (c) => {
  try {
    const caps = listCapabilities();
    return c.json(caps);
  } catch (error) {
    logger.error('listCapabilities error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============================================================================
// Local Model Status — GET /local/status
// ============================================================================

speechRoutes.get('/local/status', (c) => {
  try {
    return c.json({
      stt: getSTTModelStatus(),
      tts: getAllTTSModelStatuses(),
    });
  } catch (error) {
    logger.error('local status error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============================================================================
// Local Model Download — POST /local/download
// ============================================================================

const VALID_TTS_MODEL_IDS: TtsModelId[] = ['kokoro', 'pocket', 'kitten'];

const localDownloadSchema = z.object({
  model: z.string().default('all'),
});

speechRoutes.post(
  '/local/download',
  zValidator('json', localDownloadSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const model = body.model;

      logger.info(`local download requested: model=${model}`);

      if (model === 'stt' || model === 'all') {
        downloadSTTModel().catch((err) =>
          logger.error('STT model download failed:', err),
        );
      }

      if (model === 'tts' || model === 'all') {
        // 'tts' downloads all three TTS models for backward compatibility
        for (const id of VALID_TTS_MODEL_IDS) {
          downloadTTSModel(id).catch((err) =>
            logger.error(`TTS model (${id}) download failed:`, err),
          );
        }
      } else if (VALID_TTS_MODEL_IDS.includes(model as TtsModelId)) {
        // Download a specific TTS model
        downloadTTSModel(model as TtsModelId).catch((err) =>
          logger.error(`TTS model (${model}) download failed:`, err),
        );
      }

      return c.json({ status: 'download_started', model });
    } catch (error) {
      logger.error('local download error:', error);
      return c.json({ error: String(error) }, 500);
    }
  },
);

// ============================================================================
// Voice Cloning — POST /voice-clone
// ============================================================================

/** Maximum upload size for voice cloning samples (10 MB). */
const MAX_VOICE_CLONE_BYTES = 10 * 1024 * 1024;

speechRoutes.post('/voice-clone', async (c) => {
  try {
    const formData = await c.req.formData();
    const name = formData.get('name') as string | null;
    const file = formData.get('file');

    if (!name || !name.trim()) {
      return c.json(
        { success: false, error: 'Missing required field: name' },
        400,
      );
    }

    if (!file || !(file instanceof File)) {
      return c.json(
        { success: false, error: 'Missing required WAV file' },
        400,
      );
    }

    if (file.size > MAX_VOICE_CLONE_BYTES) {
      return c.json(
        {
          success: false,
          error: `Audio file exceeds ${MAX_VOICE_CLONE_BYTES / (1024 * 1024)} MB limit`,
        },
        413,
      );
    }

    logger.info(
      `voice-clone: name="${name}", file=${file.name} (${file.size} bytes)`,
    );

    // Decode WAV to Float32Array
    const { decodeWavToFloat32 } =
      await import('@/shared/services/speech/adapters/local');
    const wavBuffer = Buffer.from(await file.arrayBuffer());
    const { samples, sampleRate } = decodeWavToFloat32(wavBuffer);

    // Save cloned voice
    const voiceId = saveClonedVoice(name.trim(), samples, sampleRate);

    return c.json({ success: true, voiceId, name: name.trim() });
  } catch (error) {
    logger.error('voice-clone error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

// ============================================================================
// Voice Cloning — GET /voice-clone (list)
// ============================================================================

speechRoutes.get('/voice-clone', (c) => {
  try {
    const voices = listClonedVoices();
    return c.json({ voices });
  } catch (error) {
    logger.error('list cloned voices error:', error);
    return c.json({ error: String(error), voices: [] }, 500);
  }
});

// ============================================================================
// Voice Cloning — DELETE /voice-clone/:name
// ============================================================================

speechRoutes.delete('/voice-clone/:name', (c) => {
  try {
    const name = c.req.param('name');
    if (!name) {
      return c.json({ success: false, error: 'Missing voice name' }, 400);
    }

    const deleted = deleteClonedVoice(name);
    return c.json({ success: deleted });
  } catch (error) {
    logger.error('delete cloned voice error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

// ============================================================================
// Voice Cloning — POST /voice-clone/test
// ============================================================================

const voiceCloneTestSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().default('Hello! This is a test of voice cloning.'),
});

speechRoutes.post(
  '/voice-clone/test',
  zValidator('json', voiceCloneTestSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const text = body.text;

      const result = await synthesize({
        text,
        voice: body.voiceId,
      });

      if (!result.success || !result.audioData) {
        return c.json(
          { success: false, error: result.error ?? 'Synthesis failed' },
          500,
        );
      }

      return new Response(new Uint8Array(result.audioData), {
        headers: {
          'Content-Type': 'audio/wav',
          'X-Speech-Provider': result.provider,
          'X-Speech-Model': result.model,
        },
      });
    } catch (error) {
      logger.error('voice-clone test error:', error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
);

// ============================================================================
// Streaming STT — WebSocket /stt/stream
// ============================================================================

// Defer getUpgradeWebSocket() to request time so the module can be imported
// before initWebSocket(app) is called in index.ts.
function sttStreamRoute(c: Context, next: Next) {
  const upgradeWebSocket = getUpgradeWebSocket();
  const handler = upgradeWebSocket((c) => {
    let session: StreamingSTTSession | null = null;
    let openedAt = Date.now();

    const elapsedMs = () => Date.now() - openedAt;
    const classifyError = (
      error: unknown,
    ): 'no_model' | 'auth' | 'timeout' | 'unknown' => {
      const message = error instanceof Error ? error.message : String(error);
      if (/auth|api key|401|403|unauthorized|forbidden/i.test(message)) {
        return 'auth';
      }
      if (/model|configured|download|provider/i.test(message)) {
        return 'no_model';
      }
      if (/timeout|timed out/i.test(message)) {
        return 'timeout';
      }
      return 'unknown';
    };

    return {
      onOpen(_event, ws) {
        openedAt = Date.now();
        const language = c.req.query('language');
        const provider = c.req.query('provider');

        logger.info(
          `STT stream opened: language=${language ?? 'auto'}, provider=${provider ?? 'auto'}`,
        );

        session = createStreamingSTTSession({
          language: language || undefined,
          provider: provider || undefined,
        });

        const safeSendEvent = (event: Record<string, unknown>) => {
          try {
            ws.send(JSON.stringify(event));
          } catch (err) {
            logger.debug('STT stream: failed to send message', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        };

        session.onPartial((text) => {
          safeSendEvent({
            t: 'partial',
            type: 'partial',
            text,
            ms: elapsedMs(),
          });
        });

        session.onFinal((text) => {
          safeSendEvent({
            t: 'final',
            type: 'final',
            text,
            ms: elapsedMs(),
            confidence: 1,
          });
        });

        session.onEndOfTurn(() => {
          safeSendEvent({
            t: 'end_of_turn',
            type: 'end_of_turn',
            ms: elapsedMs(),
          });
        });

        session.onVADStart(() => {
          safeSendEvent({
            t: 'vad_start',
            type: 'vad_start',
            ms: elapsedMs(),
          });
        });

        session.onVADEnd(() => {
          safeSendEvent({
            t: 'vad_end',
            type: 'vad_end',
            ms: elapsedMs(),
          });
        });

        session.onError((error) => {
          logger.error('STT stream error:', error);
          const msg = error instanceof Error ? error.message : String(error);
          safeSendEvent({
            t: 'error',
            type: 'error',
            code: classifyError(error),
            msg,
            error: msg,
            ms: elapsedMs(),
          });
        });
      },

      onMessage(event) {
        if (!session) return;

        // Binary audio chunks from the frontend AudioWorklet
        if (event.data instanceof ArrayBuffer) {
          session.sendAudio(Buffer.from(event.data));
          return;
        }

        // JSON control messages from the frontend
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as { type?: string; t?: string };

          const type = msg.type ?? msg.t;
          if (type === 'stop' || type === 'flush') {
            // Frontend signals recording has stopped. Trigger session close
            // which — for the batch fallback — runs async transcription and
            // delivers results via the onFinal callback while the WS is
            // still open.
            logger.info(`STT stream: received ${type} signal from client`);
            session.close();
            session = null;
          }
        } catch {
          // Not JSON — ignore
        }
      },

      onClose() {
        logger.info('STT stream closed');
        session?.close();
        session = null;
      },

      onError(error) {
        logger.error('STT WebSocket error:', error);
        session?.close();
        session = null;
      },
    };
  });
  return handler(c, next);
}

speechRoutes.get('/stt/stream', sttStreamRoute);
speechRoutes.get('/stream', sttStreamRoute);
