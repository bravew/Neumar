/**
 * Speech MCP Server
 *
 * Inline MCP server that exposes provider-agnostic speech tools
 * to the AI agent. The agent calls these tools when users request
 * text-to-speech synthesis, audio transcription, or want to query
 * available speech capabilities and voices.
 *
 * Tools:
 *   - speech_synthesize         — Generate speech audio from text
 *   - speech_transcribe         — Transcribe an audio file to text
 *   - speech_list_voices        — List available TTS voices
 *   - speech_list_capabilities  — List speech providers and local model status
 *
 * @module mcp/speech-server
 */

import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { getAppDir } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import { getSessionWorkDir } from '@/shared/services/session-context';
import {
  getSTTModelStatus,
  getTTSModelStatus,
  listCapabilities,
  listVoices,
  synthesize,
  transcribe,
} from '@/shared/services/speech';
import type { LocalModelStatus } from '@/shared/services/speech';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SpeechMCP');

/** Format a LocalModelStatus object into a human-readable string. */
function formatModelStatus(status: LocalModelStatus): string {
  const parts = [status.model ?? 'unknown', '—', status.state];
  if (status.size) {
    parts.push(`(${status.size})`);
  }
  return parts.join(' ');
}

// ============================================================================
// Audio MIME Type Helpers
// ============================================================================

/** MIME types for common audio extensions */
const AUDIO_MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
};

// ============================================================================
// Tool Definitions
// ============================================================================

export const speechTools = [
  // ---- Synthesize Speech ----
  tool(
    'speech_synthesize',
    `Generate speech audio from text using the best available text-to-speech provider.

Supported providers (auto-detected from user settings):
  - OpenAI TTS (tts-1, tts-1-hd, gpt-4o-mini-tts)
  - ElevenLabs
  - Local models (via whisper.cpp or similar)

The tool returns the synthesis result including provider, model, format, and duration.
If work_dir is provided, the audio is saved to disk and the local path is returned.

IMPORTANT:
- OMIT voice, provider, format, speed, and model parameters unless the user explicitly requested a specific value for that parameter in their message. The system automatically uses the user's configured settings — overriding them ignores user preferences.
- Only pass voice if the user said something like "use the Alloy voice" or "speak in British English"
- Only pass provider if the user said something like "use OpenAI" or "use ElevenLabs"
- Only pass format/speed/model if the user explicitly asked for a specific format, speed, or model
\nReturns JSON: { success, provider, model, format, duration?, localPath? }`,
    {
      text: z.string().describe('The text to synthesize into speech.'),
      voice: z
        .string()
        .optional()
        .describe(
          'Voice identifier to use (e.g. "alloy", "echo", "fable", "onyx", "nova", "shimmer" for OpenAI). Use speech_list_voices to see available voices.',
        ),
      format: z
        .enum(['mp3', 'opus', 'wav', 'pcm'])
        .optional()
        .describe(
          'Output audio format: "mp3" (default), "opus", "wav", or "pcm".',
        ),
      speed: z
        .number()
        .min(0.5)
        .max(2.0)
        .optional()
        .describe(
          'Speech speed multiplier between 0.5 (half speed) and 2.0 (double speed). Default: 1.0.',
        ),
      language: z
        .string()
        .optional()
        .describe(
          'Language code for synthesis (e.g. "en", "es", "fr", "de"). Provider-dependent.',
        ),
      languageBoost: z
        .string()
        .optional()
        .describe(
          'MiniMax TTS language_boost override, e.g. English, Spanish, Chinese,Yue. Omit unless explicitly requested.',
        ),
      model: z
        .string()
        .optional()
        .describe(
          'Specific model to use (e.g. "tts-1", "tts-1-hd", "gpt-4o-mini-tts"). Auto-selected if omitted.',
        ),
      instructions: z
        .string()
        .optional()
        .describe(
          'Additional style or tone instructions for the synthesis (e.g. "Speak in a calm, professional tone").',
        ),
      provider: z
        .string()
        .optional()
        .describe(
          'Preferred provider name (e.g. "OpenAI", "ElevenLabs"). Auto-detected if omitted.',
        ),
      work_dir: z
        .string()
        .optional()
        .describe(
          'Absolute path to a directory where the generated audio file should be saved. If omitted, audio is not saved to disk.',
        ),
    },
    async ({
      text,
      voice,
      format,
      speed,
      language,
      languageBoost,
      model,
      instructions,
      provider,
      work_dir,
    }) => {
      try {
        logger.debug(
          `speech_synthesize called: text="${text.slice(0, 80)}${text.length > 80 ? '…' : ''}", provider=${provider ?? 'auto'}, voice=${voice ?? 'auto'}`,
        );

        // Confine work_dir writes to the configured workspace directory; default
        // to the active session's output dir so channel delivery can pick up
        // the file even when the agent doesn't pass work_dir explicitly.
        const sessionWorkDir = getSessionWorkDir();
        let safeWorkDir =
          work_dir ??
          (sessionWorkDir ? join(sessionWorkDir, 'output') : undefined);
        if (safeWorkDir) {
          const resolvedWorkDir = resolve(safeWorkDir);
          const workspaceRoot = getSetting('workDir') ?? getAppDir();
          if (
            !resolvedWorkDir.startsWith(workspaceRoot + sep) &&
            resolvedWorkDir !== workspaceRoot
          ) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Access denied: work_dir "${safeWorkDir}" is outside the workspace directory.`,
                },
              ],
              isError: true,
            };
          }
          safeWorkDir = resolvedWorkDir;
          // Ensure the directory exists (session folders may not be created yet)
          mkdirSync(safeWorkDir, { recursive: true });
        }

        // Read user TTS settings as defaults when agent doesn't specify
        const rawSpeech = getSetting('speech');
        let speechCfg: Record<string, unknown> | undefined;
        if (rawSpeech) {
          try {
            speechCfg = JSON.parse(rawSpeech);
          } catch {
            /* ignore */
          }
        }
        // Normalize local sub-provider IDs ('kokoro', 'pocket', 'kitten') to 'local'
        // so the router matches the LocalSpeechAdapter (name='Local') correctly.
        const rawTtsProvider = speechCfg?.ttsProvider as string | undefined;
        const LOCAL_SUBPROVIDERS = ['kokoro', 'pocket', 'kitten', 'local'];
        const normalizedProvider =
          rawTtsProvider && LOCAL_SUBPROVIDERS.includes(rawTtsProvider)
            ? 'local'
            : rawTtsProvider;
        const effectiveProvider =
          provider ??
          (normalizedProvider !== 'auto' ? normalizedProvider : undefined);
        const effectiveVoice =
          voice ?? (speechCfg?.ttsVoice as string) ?? undefined;
        const effectiveSpeed =
          speed ?? (speechCfg?.ttsSpeed as number) ?? undefined;
        const effectiveFormat =
          format ??
          (speechCfg?.ttsFormat as string as
            | 'mp3'
            | 'opus'
            | 'wav'
            | 'pcm'
            | undefined);

        const result = await synthesize({
          text,
          voice: effectiveVoice,
          format: effectiveFormat,
          speed: effectiveSpeed,
          language,
          languageBoost,
          model,
          instructions,
          provider: effectiveProvider,
          workDir: safeWorkDir,
        });

        if (!result.success) {
          logger.error(
            `speech_synthesize failed: provider=${result.provider}, model=${result.model}, error=${result.error}`,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `Speech synthesis failed: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        const lines = [
          `Speech synthesized via **${result.provider}** (model: ${result.model})`,
          `Format: ${result.format}`,
        ];

        if (result.duration !== undefined) {
          lines.push(`Duration: ${result.duration.toFixed(2)}s`);
        }

        if (result.localPath) {
          lines.push(`Saved to: ${result.localPath}`);
        } else {
          logger.warn(
            `speech_synthesize: no localPath — provider=${result.provider}, workDir=${safeWorkDir ?? '(none)'}`,
          );
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Speech synthesis error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Transcribe Audio ----
  tool(
    'speech_transcribe',
    `Transcribe an audio file to text using the best available speech-to-text provider.

Supported providers (auto-detected from user settings):
  - OpenAI Whisper (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe)
  - Local Whisper models

Supported audio formats: mp3, wav, ogg, flac, aac, m4a, opus, webm.

IMPORTANT:
- Provide the absolute file path to the audio file on disk
- Specify language if known for more accurate results
- Use timestamps: true if you need word-level or segment-level timing information
\nReturns JSON: { success, provider, model, text, detectedLanguage?, emotion?, audioEvents? }`,
    {
      audio_file_path: z
        .string()
        .describe(
          'Absolute path to the audio file to transcribe (e.g. /home/user/recording.mp3).',
        ),
      language: z
        .string()
        .optional()
        .describe(
          'Language of the audio content as a BCP-47 code (e.g. "en", "es", "fr"). Auto-detected if omitted.',
        ),
      model: z
        .string()
        .optional()
        .describe(
          'Specific STT model to use (e.g. "whisper-1", "gpt-4o-transcribe"). Auto-selected if omitted.',
        ),
      timestamps: z
        .boolean()
        .optional()
        .describe(
          'Whether to include timestamps in the transcription output. Default: false.',
        ),
      provider: z
        .string()
        .optional()
        .describe(
          'Preferred provider name (e.g. "OpenAI"). Auto-detected if omitted.',
        ),
    },
    async ({ audio_file_path, language, model, timestamps, provider }) => {
      try {
        logger.info(
          `speech_transcribe called: file="${audio_file_path}", provider=${provider ?? 'auto'}`,
        );

        // Confine file reads to the configured workspace directory.
        // process.cwd() is the bundle directory in the Tauri sidecar — use
        // getSetting('workDir') to get the user's configured workspace path.
        // Fall back to getAppDir() so session folders pass validation.
        const resolvedPath = resolve(audio_file_path);
        const workDir = getSetting('workDir') ?? getAppDir();
        if (
          !resolvedPath.startsWith(workDir + sep) &&
          resolvedPath !== workDir
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Access denied: path "${audio_file_path}" is outside the workspace directory.`,
              },
            ],
            isError: true,
          };
        }

        // Read audio file and detect MIME type from extension
        const ext = extname(resolvedPath).toLowerCase();
        const mimeType = AUDIO_MIME_MAP[ext] ?? 'audio/mpeg';

        let audioData: Buffer;
        try {
          audioData = await readFile(resolvedPath);
        } catch (readError) {
          logger.error(
            `speech_transcribe: failed to read file: ${audio_file_path}`,
            readError,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot read audio file at ${audio_file_path}: ${readError instanceof Error ? readError.message : String(readError)}`,
              },
            ],
            isError: true,
          };
        }

        logger.debug(
          `speech_transcribe: read ${Math.round(audioData.length / 1024)}KB from ${audio_file_path} (${mimeType})`,
        );

        const result = await transcribe({
          audioData,
          mimeType,
          language,
          model,
          timestamps,
          provider,
        });

        if (!result.success) {
          logger.error(
            `speech_transcribe failed: provider=${result.provider}, model=${result.model}, error=${result.error}`,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `Transcription failed: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        const lines = [
          `Transcription via **${result.provider}** (model: ${result.model}):`,
          '',
          result.text ?? '',
        ];

        if (result.detectedLanguage) {
          lines.push('', `Detected language: ${result.detectedLanguage}`);
        }

        if (result.emotion) {
          lines.push(`Emotion: ${result.emotion}`);
        }

        if (result.audioEvents && result.audioEvents.length > 0) {
          lines.push(`Audio events: ${result.audioEvents.join(', ')}`);
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Transcription error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- List Voices ----
  tool(
    'speech_list_voices',
    `List all available text-to-speech voices.

Returns the available voices for the specified provider (or all providers if none is specified).
Use the voice names returned here with the speech_synthesize tool.
\nReturns JSON: { voices: [{ id, name?, provider?, gender?, language? }] }`,
    {
      provider: z
        .string()
        .optional()
        .describe(
          'Filter voices by provider name (e.g. "OpenAI", "ElevenLabs"). Returns voices from all providers if omitted.',
        ),
    },
    async ({ provider }) => {
      try {
        logger.debug(
          `speech_list_voices called: provider=${provider ?? 'all'}`,
        );

        const voices = await listVoices(provider);

        if (!voices || voices.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: provider
                  ? `No voices found for provider "${provider}".`
                  : 'No TTS voices available. Configure a speech provider in Settings → Models.',
              },
            ],
          };
        }

        const lines = [
          `**Available TTS Voices${provider ? ` (${provider})` : ''}:**`,
          '',
        ];

        for (const voice of voices) {
          const parts = [`- **${voice.id}**`];
          if (voice.name && voice.name !== voice.id) {
            parts.push(`(${voice.name})`);
          }
          if (voice.provider) {
            parts.push(`[${voice.provider}]`);
          }
          if (voice.gender) {
            parts.push(`— ${voice.gender}`);
          }
          if (voice.language) {
            parts.push(`Language: ${voice.language}`);
          }
          lines.push(parts.join(' '));
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error listing voices: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- List Capabilities ----
  tool(
    'speech_list_capabilities',
    `List all available speech providers and local model status.

Returns a summary of:
  - Configured TTS (text-to-speech) providers
  - Configured STT (speech-to-text) providers
  - Providers that support streaming synthesis
  - Local model download/availability status

Use this before speech_synthesize or speech_transcribe to check what is available.
\nReturns JSON: { ttsProviders: string[], sttProviders: string[], streamingSTTProviders?: string[], streamingTTSProviders?: string[] }`,
    {},
    async () => {
      try {
        logger.debug('speech_list_capabilities called');

        const [caps, sttStatus, ttsStatus] = await Promise.all([
          listCapabilities(),
          getSTTModelStatus(),
          getTTSModelStatus(),
        ]);

        const lines: string[] = ['**Available Speech Providers:**', ''];

        if (caps.ttsProviders && caps.ttsProviders.length > 0) {
          lines.push(`TTS (text-to-speech): ${caps.ttsProviders.join(', ')}`);
        } else {
          lines.push('TTS (text-to-speech): No providers configured');
        }

        if (caps.sttProviders && caps.sttProviders.length > 0) {
          lines.push(`STT (speech-to-text): ${caps.sttProviders.join(', ')}`);
        } else {
          lines.push('STT (speech-to-text): No providers configured');
        }

        if (
          caps.streamingSTTProviders &&
          caps.streamingSTTProviders.length > 0
        ) {
          lines.push(`Streaming STT: ${caps.streamingSTTProviders.join(', ')}`);
        }

        if (
          caps.streamingTTSProviders &&
          caps.streamingTTSProviders.length > 0
        ) {
          lines.push(`Streaming TTS: ${caps.streamingTTSProviders.join(', ')}`);
        }

        lines.push('', '**Local Model Status:**');

        if (ttsStatus) {
          lines.push(`TTS model: ${formatModelStatus(ttsStatus)}`);
        }

        if (sttStatus) {
          lines.push(`STT model: ${formatModelStatus(sttStatus)}`);
        }

        if (!ttsStatus && !sttStatus) {
          lines.push('No local models configured.');
        }

        if (
          (!caps.ttsProviders || caps.ttsProviders.length === 0) &&
          (!caps.sttProviders || caps.sttProviders.length === 0)
        ) {
          lines.push(
            '',
            'To enable speech features, add a provider with speech models in Settings → Models.',
          );
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error listing capabilities: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),
];

// ============================================================================
// Export
// ============================================================================

/** All speech tool names for allowedTools registration */
export const SPEECH_TOOL_NAMES = speechTools.map((t) => t.name);

/** Create the Speech MCP server instance */
export function createSpeechMcpServer() {
  return createSdkMcpServer({
    name: 'speech',
    version: '1.0.0',
    tools: speechTools,
  });
}
