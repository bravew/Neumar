/**
 * Speech — Provider Registry
 *
 * Maps provider identifiers to adapter factory functions.
 * New providers are added by registering a factory here.
 *
 * The registry is pattern-based:
 *   • It matches provider IDs or base URLs to adapter factories.
 *   • A provider is considered "speech-capable" if any of its models
 *     match TTS or STT generation patterns.
 *
 * @module speech/registry
 */

import { DeepgramSpeechAdapter } from './adapters/deepgram';
import { ElevenLabsSpeechAdapter } from './adapters/elevenlabs';
import { LocalSpeechAdapter } from './adapters/local';
import { MiniMaxSpeechAdapter } from './adapters/minimax';
import { OpenAISpeechAdapter } from './adapters/openai';
import { SenseAudioSpeechAdapter } from './adapters/senseaudio';
import type { SpeechAdapter, SpeechProviderConfig } from './types';

// ============================================================================
// Adapter Factories
// ============================================================================

type AdapterFactory = (config: SpeechProviderConfig) => SpeechAdapter;

/**
 * Each entry maps a detection pattern to an adapter factory.
 * Detection is tried against the provider's base URL and model names.
 */
interface RegistryEntry {
  /** Human-readable label for logs */
  name: string;
  /** Test against base URL */
  urlPattern?: RegExp;
  /** Test against any model name in the provider's model list */
  modelPattern?: RegExp;
  /** Factory — creates the adapter with the provider config */
  factory: AdapterFactory;
}

// ============================================================================
// Registry Entries
// ============================================================================

/**
 * Ordered list of provider detection rules.
 * First match wins (more specific patterns should come first).
 */
const REGISTRY: RegistryEntry[] = [
  {
    name: 'Local',
    urlPattern: /^local$/i,
    modelPattern: /sensevoice|kokoro|piper|pocket|kitten/i,
    factory: (config) => new LocalSpeechAdapter(config),
  },
  {
    name: 'SenseAudio',
    urlPattern: /senseaudio\.cn/i,
    modelPattern: /senseaudio.*tts|tts.*senseaudio/i,
    factory: (config) => new SenseAudioSpeechAdapter(config),
  },
  {
    name: 'Deepgram',
    urlPattern: /deepgram\.com/i,
    modelPattern: /nova-3|nova-2|flux|aura/i,
    factory: (config) => new DeepgramSpeechAdapter(config),
  },
  {
    name: 'MiniMax',
    urlPattern: /minimax\.io|api-uw\.minimax/i,
    modelPattern: /^speech-(?:2\.8|2\.6|02|01)-(?:hd|turbo)$/i,
    factory: (config) => new MiniMaxSpeechAdapter(config),
  },
  {
    name: 'ElevenLabs',
    urlPattern: /elevenlabs\.io/i,
    modelPattern: /^eleven[-_]|^scribe/i,
    factory: (config) => new ElevenLabsSpeechAdapter(config),
  },
  {
    name: 'OpenAI',
    urlPattern: /openai\.com/i,
    modelPattern:
      /(?:^|\/)(?:tts-1|tts-1-hd)$|gpt-4o-mini-tts|whisper|gpt-4o-transcribe/i,
    factory: (config) => new OpenAISpeechAdapter(config),
  },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Try to create an adapter for a given provider config.
 *
 * Returns `null` if the provider doesn't match any known speech
 * service (i.e., it's a chat-only provider).
 */
export function createAdapterForProvider(
  config: SpeechProviderConfig,
): SpeechAdapter | null {
  for (const entry of REGISTRY) {
    // Match by URL
    if (entry.urlPattern && entry.urlPattern.test(config.baseUrl)) {
      return entry.factory(config);
    }
    // Match by model name
    if (entry.modelPattern) {
      const pattern = entry.modelPattern;
      const hasMatch = config.models.some((m) => pattern.test(m));
      if (hasMatch) {
        return entry.factory(config);
      }
    }
  }
  return null;
}

/**
 * Check if a specific model name is recognised as a TTS model.
 */
export function isTTSModel(modelName: string): boolean {
  return /tts-1|gpt-4o-mini-tts|aura|kokoro|piper|pocket|kitten|eleven[-_]|senseaudio.*tts|tts.*senseaudio|^speech-(?:2\.8|2\.6|02|01)-(?:hd|turbo)$/i.test(
    modelName,
  );
}

/**
 * Check if a specific model name is recognised as an STT model.
 */
export function isSTTModel(modelName: string): boolean {
  return /whisper|gpt-4o-transcribe|nova-3|nova-2|flux|sensevoice|scribe/i.test(
    modelName,
  );
}

/**
 * Check if a specific model name is recognised as a speech model (TTS or STT).
 */
export function isSpeechModel(modelName: string): boolean {
  return isTTSModel(modelName) || isSTTModel(modelName);
}
