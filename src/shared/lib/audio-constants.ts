/**
 * Shared audio constants used across speech hooks and components.
 *
 * Centralizes sample rates, AudioWorklet configuration, and microphone
 * constraints so they stay in sync between useSpeech, useVoiceRecorder,
 * MessageAudioButton, and any future consumers.
 */

/** Microphone capture sample rate (Hz) — matches STT model expectations. */
export const STT_SAMPLE_RATE = 16_000;

/** TTS PCM output sample rate (Hz) — OpenAI & Kokoro both output 24 kHz. */
export const TTS_PCM_SAMPLE_RATE = 24_000;

/** AudioWorklet processor name registered via addModule. */
export const WORKLET_NAME = 'pcm-capture-processor';

/** Path to the AudioWorklet processor script (served from /public). */
export const WORKLET_PATH = '/audio-worklets/pcm-capture-processor.js';

/** Standard microphone constraints for speech capture. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

/** Check if the current browser supports AudioWorklet. */
export function supportsAudioWorklet(): boolean {
  return (
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined'
  );
}
