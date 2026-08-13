/**
 * Speech Service — Public API
 *
 * Re-exports everything consumers need. Internal implementation
 * details (adapters, registry) stay private.
 *
 * @module speech
 */

// Types
export type {
  ConversationEvent,
  ConversationState,
  LocalModelStatus,
  SpeechAdapter,
  SpeechProviderConfig,
  STTParams,
  STTResult,
  StreamingSTTConfig,
  StreamingSTTSession,
  TranscriptEntry,
  TranscriptSegment,
  TTSParams,
  TTSResult,
  VoiceInfo,
  WordTimestamp,
} from './types';

// Router (main entry point for speech operations)
export {
  createStreamingSTTSession,
  hasSpeechProvider,
  isSTTModel,
  isTTSModel,
  listCapabilities,
  listVoices,
  synthesize,
  synthesizeSoundEffect,
  synthesizeStream,
  transcribe,
} from './router';

// Registry (for advanced use cases)
export { createAdapterForProvider, isSpeechModel } from './registry';

// Local model management
export {
  deleteClonedVoice,
  downloadSTTModel,
  downloadTTSModel,
  getAllTTSModelStatuses,
  getSTTModelStatus,
  getTTSModelStatus,
  listClonedVoices,
  loadClonedVoice,
  saveClonedVoice,
} from './local-models';

// Local model types
export type { TtsModelId } from './local-models';
