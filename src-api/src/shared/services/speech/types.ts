/**
 * Speech Service — Shared Types
 *
 * Provider-agnostic interfaces for TTS (Text-to-Speech) and STT (Speech-to-Text).
 * Every adapter (OpenAI, Deepgram, ElevenLabs, Local, …) implements these
 * so the router and MCP server never couple to a single vendor.
 *
 * @module speech/types
 */

// ============================================================================
// Provider Config (read from synced settings)
// ============================================================================

/**
 * Minimal provider info needed by speech adapters.
 * Matches the shape synced from the frontend AIProvider type.
 */
import type { MediaDataEgress } from '@/shared/media/data-egress';

export interface SpeechProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

// ============================================================================
// TTS Parameters & Results
// ============================================================================

/** Parameters for text-to-speech synthesis */
export interface TTSParams {
  /** Text to synthesize into speech */
  text: string;
  /** Voice ID (e.g., 'alloy', 'kokoro-0') */
  voice?: string;
  /** Output audio format */
  format?: 'mp3' | 'opus' | 'wav' | 'pcm' | 'flac';
  /** Playback speed multiplier (0.5 - 2.0) */
  speed?: number;
  /** Target audio duration in seconds (for video dubbing) */
  targetDuration?: number;
  /** BCP-47 language hint */
  language?: string;
  /** Provider-specific language recognition boost (MiniMax T2A `language_boost`). */
  languageBoost?: string;
  /** Model ID override */
  model?: string;
  /** Tone/style instructions (gpt-4o-mini-tts) */
  instructions?: string;
  /** Working directory for saving output files */
  workDir?: string;
  /** Abort signal for cancelling in-flight requests */
  signal?: AbortSignal;
}

export type SpeechProviderErrorCode =
  | 'auth'
  | 'budget'
  | 'provider'
  | 'quota'
  | 'rate_limited';

/** Result of a TTS synthesis call */
export interface TTSResult {
  success: boolean;
  /** Provider that fulfilled the request */
  provider: string;
  /** Model used */
  model: string;
  /** Raw audio data (for batch synthesis) */
  audioData?: Buffer;
  /** Local file path if saved to disk */
  localPath?: string;
  /** Audio duration in seconds */
  duration?: number;
  /** Audio format */
  format?: string;
  /** Word-level timestamps for interruption context */
  wordTimestamps?: WordTimestamp[];
  /** Error message when success is false */
  error?: string;
  /** Structured provider error classification when synthesis fails. */
  errorCode?: SpeechProviderErrorCode;
}

// ============================================================================
// STT Parameters & Results
// ============================================================================

/** Parameters for speech-to-text transcription */
export interface STTParams {
  /** Raw audio data to transcribe */
  audioData: Buffer;
  /** MIME type of the audio (e.g., 'audio/wav', 'audio/webm') */
  mimeType?: string;
  /** BCP-47 language hint ('' = auto-detect) */
  language?: string;
  /** Model ID override */
  model?: string;
  /** Whether to include word-level timestamps */
  timestamps?: boolean;
  /** Optional prompt/context to improve accuracy */
  prompt?: string;
}

/** A segment of transcribed text with timing */
export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

/** Result of an STT transcription call */
export interface STTResult {
  success: boolean;
  /** Provider that fulfilled the request */
  provider: string;
  /** Model used */
  model: string;
  /** Whether the transcribed audio stayed local or was sent to a provider. */
  dataEgress?: MediaDataEgress;
  /** Full transcribed text */
  text?: string;
  /** Segments with timing (when timestamps requested) */
  segments?: TranscriptSegment[];
  /** Auto-detected language */
  detectedLanguage?: string;
  /** Audio duration in seconds */
  duration?: number;
  /** Detected emotion (SenseVoice) */
  emotion?: string;
  /** Detected audio events (SenseVoice: laughter, applause, etc.) */
  audioEvents?: string[];
  /** Error message when success is false */
  error?: string;
}

// ============================================================================
// Streaming STT Session
// ============================================================================

/** Configuration for creating a streaming STT session */
export interface StreamingSTTConfig {
  /** BCP-47 language hint */
  language?: string;
  /** Model ID override */
  model?: string;
  /** Audio encoding format */
  encoding?: 'linear16' | 'opus' | 'mulaw';
  /** Audio sample rate in Hz */
  sampleRate?: number;
  /** Number of audio channels */
  channels?: number;
}

/** A live streaming STT session */
export interface StreamingSTTSession {
  /** Feed audio data chunks to the session */
  sendAudio(chunk: Buffer): void;
  /** Register callback for partial (interim) transcripts */
  onPartial(cb: (text: string) => void): void;
  /** Register callback for final (committed) transcripts */
  onFinal(cb: (text: string) => void): void;
  /** Register callback for end-of-turn detection (Deepgram Flux / VAD) */
  onEndOfTurn(cb: () => void): void;
  /** Register callback for voice activity start */
  onVADStart(cb: () => void): void;
  /** Register callback for voice activity end (silence detected) */
  onVADEnd(cb: () => void): void;
  /** Register callback for errors */
  onError(cb: (error: Error) => void): void;
  /** Close the session and clean up resources */
  close(): void;
}

// ============================================================================
// Voice Info
// ============================================================================

/** Information about an available TTS voice */
export interface VoiceInfo {
  /** Voice identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Supported language(s) */
  language?: string;
  /** Voice gender */
  gender?: 'male' | 'female' | 'neutral';
  /** Short description of the voice character */
  description?: string;
  /** Provider category, when the upstream catalog exposes one. */
  category?: string;
  /** URL to preview audio sample */
  previewUrl?: string;
  /** Provider that offers this voice */
  provider?: string;
}

// ============================================================================
// Word Timestamps
// ============================================================================

/** Word-level timing for interruption context tracking */
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * Every speech provider implements this interface.
 *
 * Methods may throw on transport errors; the caller (MCP server / router)
 * catches and converts them to user-friendly results.
 */
export interface SpeechAdapter {
  /** Human-readable name (e.g., "OpenAI", "Deepgram") */
  readonly name: string;

  /** Whether user audio stays local or is sent to a provider. */
  readonly dataEgress: MediaDataEgress;

  /** Whether this adapter supports TTS */
  readonly supportsTTS: boolean;

  /** Whether this adapter supports STT */
  readonly supportsSTT: boolean;

  /** Whether this adapter supports streaming (live) STT */
  readonly supportsStreamingSTT: boolean;

  /** Whether this adapter supports streaming TTS */
  readonly supportsStreamingTTS: boolean;

  /** Whether this adapter supports sound-effect generation */
  readonly supportsSFX?: boolean;

  /** Synthesize speech from text (batch: returns full audio) */
  synthesize?(params: TTSParams): Promise<TTSResult>;

  /** Synthesize speech as a stream of audio chunks */
  synthesizeStream?(params: TTSParams): AsyncGenerator<Buffer>;

  /** Synthesize a short sound effect from prompt text. */
  synthesizeSfx?(params: TTSParams): Promise<TTSResult>;

  /** Transcribe audio to text (batch: returns full transcript) */
  transcribe?(params: STTParams): Promise<STTResult>;

  /** Create a streaming STT session for live transcription */
  transcribeStream?(config: StreamingSTTConfig): StreamingSTTSession;

  /** List available TTS voices */
  listVoices?(): Promise<VoiceInfo[]>;
}

// ============================================================================
// Conversation Types (Phase 7+)
// ============================================================================

/** State of a voice conversation */
export type ConversationState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking';

/** Events emitted during a voice conversation */
export type ConversationEvent =
  | { type: 'speech_start' }
  | { type: 'partial_transcript'; text: string }
  | { type: 'final_transcript'; text: string }
  | { type: 'end_of_turn' }
  | { type: 'agent_speaking'; text: string }
  | { type: 'agent_audio'; audio: ArrayBuffer }
  | { type: 'agent_done' }
  | { type: 'barge_in'; heardText?: string }
  | { type: 'filler_start' }
  | { type: 'error'; message: string };

/** A transcript entry in a voice conversation */
export interface TranscriptEntry {
  timestamp: number;
  speaker: 'user' | 'agent';
  text: string;
  isFinal: boolean;
}

// ============================================================================
// Local Model Status (for model management UI)
// ============================================================================

/** Status of a local speech model */
export interface LocalModelStatus {
  state: 'not_downloaded' | 'downloading' | 'loading' | 'ready' | 'error';
  downloadProgress?: {
    downloadedBytes: number;
    totalBytes: number;
  };
  /** Granular phase description (e.g. 'Downloading...', 'Extracting...', 'Loading model...') */
  phase?: string;
  model?: string;
  size?: string;
  error?: string;
}
