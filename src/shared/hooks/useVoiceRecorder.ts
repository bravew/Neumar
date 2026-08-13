/**
 * Voice Recorder Hook
 *
 * Captures microphone audio using AudioWorklet (primary) with MediaRecorder
 * fallback. Optionally integrates VAD (Voice Activity Detection) from
 * @ricky0123/vad-web when available.
 *
 * Primary mode: Mic -> AudioContext(16kHz) -> AudioWorkletNode -> Int16 PCM -> onChunk
 * Fallback mode: Mic -> MediaRecorder(webm/opus, 250ms) -> Blob -> ArrayBuffer -> onChunk
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MIC_CONSTRAINTS,
  STT_SAMPLE_RATE,
  supportsAudioWorklet,
  WORKLET_NAME,
  WORKLET_PATH,
} from '@/shared/lib/audio-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal interface for the VAD instance returned by @ricky0123/vad-web */
interface VADInstance {
  destroy(): void;
  start(): void;
}

export interface UseVoiceRecorderOptions {
  onChunk?: (data: ArrayBuffer) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onSpeechProbability?: (prob: number) => void;
}

export interface UseVoiceRecorderReturn {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  duration: number;
  permissionStatus: 'prompt' | 'granted' | 'denied';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEDIA_RECORDER_TIMESLICE_MS = 250;
const DURATION_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceRecorder(
  options?: UseVoiceRecorderOptions,
): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [permissionStatus, setPermissionStatus] = useState<
    'prompt' | 'granted' | 'denied'
  >('prompt');

  // Stable reference to callbacks so we never re-create start/stop when the
  // consumer passes new inline functions.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Mutable refs for recording resources that must survive across renders.
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadRef = useRef<VADInstance | null>(null);
  const isRecordingRef = useRef(false);

  // ------------------------------------------------------------------
  // Permission status tracking
  // ------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let permissionResult: PermissionStatus | null = null;
    let handleChange: (() => void) | null = null;

    async function queryPermission() {
      try {
        const result = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });

        // Guard against race: if cleanup ran while we were awaiting, don't
        // attach any listeners — just bail out.
        if (cancelled) return;

        permissionResult = result;
        setPermissionStatus(result.state as 'prompt' | 'granted' | 'denied');

        handleChange = () => {
          if (!cancelled) {
            setPermissionStatus(
              result.state as 'prompt' | 'granted' | 'denied',
            );
          }
        };

        result.addEventListener('change', handleChange);
      } catch {
        // permissions.query may not be supported for microphone in all browsers
      }
    }

    queryPermission();

    return () => {
      cancelled = true;
      if (permissionResult && handleChange) {
        permissionResult.removeEventListener('change', handleChange);
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Cleanup helper (shared between stopRecording and unmount)
  // ------------------------------------------------------------------

  const cleanup = useCallback(() => {
    // Stop duration timer
    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Destroy VAD
    if (vadRef.current) {
      try {
        vadRef.current.destroy();
      } catch {
        // best-effort
      }
      vadRef.current = null;
    }

    // Stop MediaRecorder
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // already stopped
      }
      mediaRecorderRef.current = null;
    }

    // Disconnect AudioWorklet
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      workletNodeRef.current = null;
    }

    // Disconnect source node
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      sourceNodeRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        // already closed
      }
      audioContextRef.current = null;
    }

    // Stop all media tracks
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  // ------------------------------------------------------------------
  // VAD initialisation (best-effort)
  // ------------------------------------------------------------------

  const initVad = useCallback(async (stream: MediaStream) => {
    try {
      const { MicVAD } = await import('@ricky0123/vad-web');

      const vad = await MicVAD.new({
        getStream: () => Promise.resolve(stream),
        onSpeechStart: () => {
          optionsRef.current?.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          optionsRef.current?.onSpeechEnd?.();
        },
        onFrameProcessed: (probabilities) => {
          optionsRef.current?.onSpeechProbability?.(probabilities.isSpeech);
        },
      });

      vad.start();
      vadRef.current = vad as unknown as VADInstance;
    } catch {
      // VAD not available or failed to load -- non-critical, skip silently
    }
  }, []);

  // ------------------------------------------------------------------
  // AudioWorklet-based recording
  // ------------------------------------------------------------------

  const startWorkletRecording = useCallback(async (stream: MediaStream) => {
    const audioContext = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
    audioContextRef.current = audioContext;

    await audioContext.audioWorklet.addModule(WORKLET_PATH);

    const source = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    const workletNode = new AudioWorkletNode(audioContext, WORKLET_NAME);
    workletNodeRef.current = workletNode;

    workletNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | undefined;
      if (data && data.byteLength > 0) {
        optionsRef.current?.onChunk?.(data);
      }
    };

    source.connect(workletNode);
    // Connect through a silent GainNode so the AudioContext processes audio
    // (required for worklet to fire) without playing mic input through speakers.
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(audioContext.destination);
    workletNode.connect(silentGain);
  }, []);

  // ------------------------------------------------------------------
  // MediaRecorder fallback
  // ------------------------------------------------------------------

  const startMediaRecorderFallback = useCallback((stream: MediaStream) => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (event: BlobEvent) => {
      if (event.data.size > 0) {
        const buffer = await event.data.arrayBuffer();
        optionsRef.current?.onChunk?.(buffer);
      }
    };

    recorder.start(MEDIA_RECORDER_TIMESLICE_MS);
  }, []);

  // ------------------------------------------------------------------
  // Start recording
  // ------------------------------------------------------------------

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    streamRef.current = stream;

    // Update permission status after successful getUserMedia
    setPermissionStatus('granted');

    // Choose capture method — wrap in try/catch to release the mic if init fails
    try {
      if (supportsAudioWorklet()) {
        await startWorkletRecording(stream);
      } else {
        startMediaRecorderFallback(stream);
      }
    } catch (err) {
      cleanup(); // stops tracks, clears refs
      throw err;
    }

    // Kick off VAD in parallel (best-effort, does not block recording)
    initVad(stream);

    // Duration tracking
    setDuration(0);
    durationTimerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, DURATION_INTERVAL_MS);

    isRecordingRef.current = true;
    setIsRecording(true);
  }, [startWorkletRecording, startMediaRecorderFallback, initVad, cleanup]);

  // ------------------------------------------------------------------
  // Stop recording
  // ------------------------------------------------------------------

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;

    // Flush remaining data from the worklet before tearing down
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.postMessage({ command: 'flush' });
      } catch {
        // port may already be closed
      }
    }

    cleanup();

    isRecordingRef.current = false;
    setIsRecording(false);
    setDuration(0);
  }, [cleanup]);

  // ------------------------------------------------------------------
  // Unmount cleanup
  // ------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        cleanup();
        isRecordingRef.current = false;
      }
    };
  }, [cleanup]);

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    startRecording,
    stopRecording,
    isRecording,
    duration,
    permissionStatus,
  };
}
