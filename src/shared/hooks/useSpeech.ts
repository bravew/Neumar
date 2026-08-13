/**
 * useSpeech — Orchestrates STT + TTS for normal chat mode.
 *
 * STT: Push-to-talk via WebSocket streaming. Opens a WebSocket to the API
 *      speech/stt/stream endpoint, captures microphone audio using AudioWorklet
 *      (PCM Int16 @ 16 kHz), and streams binary chunks over the socket. Partial
 *      and final transcripts are delivered via callbacks and local state.
 *
 * TTS (batch): POST full text to /speech/synthesize, queue PCM response in
 *      AudioPlaybackEngine for gapless playback.
 *
 * TTS (streaming): Buffer incoming LLM tokens, split on sentence boundaries,
 *      POST each complete sentence for synthesis, and queue audio as it arrives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { getSettings, useSettingsValue } from '@/shared/db/settings';
import {
  MIC_CONSTRAINTS,
  STT_SAMPLE_RATE,
  supportsAudioWorklet,
  TTS_PCM_SAMPLE_RATE,
  WORKLET_NAME,
  WORKLET_PATH,
} from '@/shared/lib/audio-constants';
import {
  getAudioPlaybackEngine,
  pipePcmStreamToEngine,
} from '@/shared/lib/audio-playback';
import type { SttEvent } from '@/shared/types/speech-stream';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseSpeechOptions {
  /** Called when final transcript is ready */
  onTranscript?: (text: string) => void;
  /** Called when partial transcript updates */
  onPartialTranscript?: (text: string) => void;
}

export interface UseSpeechReturn {
  // STT
  startListening: () => Promise<void>;
  stopListening: () => void;
  isListening: boolean;
  /** Elapsed listening time in seconds (integer, updated every 1s). */
  listeningDuration: number;
  partialTranscript: string;

  // TTS
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  isSpeaking: boolean;

  // TTS streaming (sentence-by-sentence for live LLM output)
  feedTokens: (tokens: string) => void;
  flushTokens: () => void;

  // State
  isAvailable: boolean;
}

type SttWireEvent = Partial<SttEvent> & {
  t?: SttEvent['t'];
  type?: SttEvent['type'];
  text?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sentence-ending punctuation followed by whitespace or end of string.
 * Captures the delimiter so we can split while keeping the punctuation
 * attached to the sentence it terminates.
 */
const SENTENCE_BOUNDARY_RE = /([.?!\n])(?:\s|$)/;

/** Max time (ms) to wait for batch STT result after sending "stop" signal. */
const BATCH_STT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the WebSocket URL from API_BASE_URL by replacing the http(s) scheme
 * with ws(s). This ensures the correct host/port in both dev and production.
 */
function buildWsUrl(): string {
  const speech = getSettings().speech;
  const url = new URL(
    API_BASE_URL.replace(/^http/, 'ws') + '/speech/stt/stream',
  );
  if (speech.sttLanguage) url.searchParams.set('language', speech.sttLanguage);
  if (speech.sttProvider && speech.sttProvider !== 'auto') {
    url.searchParams.set('provider', speech.sttProvider);
  }
  return url.toString();
}

/**
 * POST text to the synthesis endpoint and return the raw audio ArrayBuffer
 * along with the actual audio format.
 */
async function synthesize(
  text: string,
  signal?: AbortSignal,
): Promise<{ data: ArrayBuffer; format: string }> {
  const speech = getSettings().speech;
  const format = speech.ttsFormat ?? 'pcm';
  const response = await fetch(`${API_BASE_URL}/speech/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: speech.ttsVoice,
      speed: speech.ttsSpeed,
      format,
      provider: speech.ttsProvider !== 'auto' ? speech.ttsProvider : undefined,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `TTS synthesis failed: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  const actualFormat = contentType.includes('pcm') ? 'pcm' : format;
  return { data: await response.arrayBuffer(), format: actualFormat };
}

async function synthesizeToPlayback(
  text: string,
  signal: AbortSignal | undefined,
  queue: (chunk: ArrayBuffer, format: string) => Promise<void> | void,
): Promise<void> {
  const speech = getSettings().speech;
  const format = speech.ttsFormat ?? 'pcm';

  if (!speech.ttsStreaming || format !== 'pcm') {
    const result = await synthesize(text, signal);
    await queue(result.data, result.format);
    return;
  }

  const params = new URLSearchParams({
    text,
    format,
  });
  if (speech.ttsVoice) params.set('voice', speech.ttsVoice);
  if (speech.ttsSpeed) params.set('speed', String(speech.ttsSpeed));
  if (speech.ttsProvider && speech.ttsProvider !== 'auto') {
    params.set('provider', speech.ttsProvider);
  }

  const response = await fetch(
    `${API_BASE_URL}/speech/synthesize/stream?${params.toString()}`,
    { signal },
  );

  if (!response.ok || !response.body) {
    throw new Error(
      `TTS stream failed: ${response.status} ${response.statusText}`,
    );
  }

  // The backend may downgrade to a non-PCM format when the chosen provider
  // can't natively serve PCM (e.g. Local returns WAV). Inspect the actual
  // Content-Type and route via the queue() callback for non-PCM responses.
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('audio/pcm')) {
    await pipePcmStreamToEngine(response, TTS_PCM_SAMPLE_RATE, signal);
    return;
  }
  await queue(
    await response.arrayBuffer(),
    contentType.includes('wav') ? 'wav' : format,
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSpeech(options?: UseSpeechOptions): UseSpeechReturn {
  const settings = useSettingsValue();

  // ---- State ----
  const [isListening, setIsListening] = useState(false);
  const [listeningDuration, setListeningDuration] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Stable reference to latest callbacks so start/stop never go stale.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // ---- Refs for STT resources ----
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isListeningRef = useRef(false);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sttTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partialDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopListeningRef = useRef<() => void>(() => undefined);

  // ---- Refs for TTS streaming ----
  const sentenceBufferRef = useRef('');
  const ttsAbortRef = useRef<AbortController | null>(null);
  const streamingAbortRef = useRef<AbortController | null>(null);

  // ==========================================================================
  // STT — Streaming transcription via WebSocket + AudioWorklet
  // ==========================================================================

  const cleanupSTT = useCallback(() => {
    // Stop duration timer
    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (partialDebounceRef.current !== null) {
      clearTimeout(partialDebounceRef.current);
      partialDebounceRef.current = null;
    }

    // Disconnect worklet
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      workletNodeRef.current = null;
    }

    // Disconnect source
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      sourceNodeRef.current = null;
    }

    // Close AudioContext
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // already closed
      }
      audioCtxRef.current = null;
    }

    // Stop media tracks
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // already closed
      }
      wsRef.current = null;
    }
  }, []);

  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;

    if (!supportsAudioWorklet()) {
      throw new Error(
        'AudioWorklet is required for streaming STT but is not supported in this browser.',
      );
    }

    // 1. Open WebSocket
    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as SttWireEvent;
        const type = msg.type ?? msg.t;

        if (type === 'partial') {
          const text = msg.text ?? '';
          const delay = Math.max(
            0,
            getSettings().speech.sttPartialDebounceMs ?? 80,
          );
          if (partialDebounceRef.current !== null) {
            clearTimeout(partialDebounceRef.current);
          }
          partialDebounceRef.current = setTimeout(() => {
            setPartialTranscript(text);
            optionsRef.current?.onPartialTranscript?.(text);
          }, delay);
        } else if (type === 'final') {
          if (partialDebounceRef.current !== null) {
            clearTimeout(partialDebounceRef.current);
            partialDebounceRef.current = null;
          }
          setPartialTranscript('');
          optionsRef.current?.onTranscript?.(msg.text ?? '');
        } else if (type === 'vad_end' && getSettings().speech.sttVadEnabled) {
          stopListeningRef.current();
        }
      } catch {
        // Non-JSON message — ignore
      }
    };

    ws.onerror = () => {
      // On error, stop listening to avoid dangling state
      cleanupSTT();
      isListeningRef.current = false;
      setIsListening(false);
      setPartialTranscript('');
    };

    ws.onclose = () => {
      // Only reset state if we haven't already cleaned up via stopListening
      if (isListeningRef.current) {
        cleanupSTT();
        isListeningRef.current = false;
        setIsListening(false);
        setPartialTranscript('');
      }
    };

    // Wait for WebSocket to open before starting audio capture
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      // Override onerror for the connection phase only
      const postOpenOnError = ws.onerror;
      ws.onerror = () => {
        reject(new Error('WebSocket connection failed'));
      };

      // After successful open, restore the post-open error handler
      const origOnOpen = ws.onopen;
      ws.onopen = (event) => {
        ws.onerror = postOpenOnError;
        origOnOpen?.call(ws, event);
      };
    });

    // 2. Start mic capture → AudioWorklet → send binary chunks over WebSocket
    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        ...MIC_CONSTRAINTS,
        audio: {
          ...(typeof MIC_CONSTRAINTS.audio === 'object'
            ? MIC_CONSTRAINTS.audio
            : {}),
          sampleRate: STT_SAMPLE_RATE,
          channelCount: 1,
        },
      });
    } catch (err) {
      // Cleanup the already-open WebSocket to prevent leaks
      cleanupSTT();
      isListeningRef.current = false;
      setIsListening(false);
      throw err;
    }
    streamRef.current = mediaStream;

    const audioCtx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
    audioCtxRef.current = audioCtx;

    // Wrap remaining setup so cleanupSTT() is called if addModule() or any
    // subsequent step throws — leaving stream + AudioContext open otherwise.
    try {
      await audioCtx.audioWorklet.addModule(WORKLET_PATH);

      const source = audioCtx.createMediaStreamSource(mediaStream);
      sourceNodeRef.current = source;

      const workletNode = new AudioWorkletNode(audioCtx, WORKLET_NAME);
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event: MessageEvent) => {
        const data = event.data as ArrayBuffer | undefined;
        if (
          data &&
          data.byteLength > 0 &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          wsRef.current.send(data);
        }
      };

      source.connect(workletNode);
      // Connect through a silent GainNode so the AudioContext processes audio
      // (required for worklet to fire) without playing mic input through speakers.
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(audioCtx.destination);
      workletNode.connect(silentGain);

      // Start duration tracking
      setListeningDuration(0);
      durationTimerRef.current = setInterval(() => {
        setListeningDuration((prev) => prev + 1);
      }, 1_000);

      isListeningRef.current = true;
      setIsListening(true);
      setPartialTranscript('');
    } catch (err) {
      cleanupSTT();
      isListeningRef.current = false;
      setIsListening(false);
      throw err;
    }
  }, [cleanupSTT]);

  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;
    if (partialDebounceRef.current !== null) {
      clearTimeout(partialDebounceRef.current);
      partialDebounceRef.current = null;
    }

    // Flush remaining data from the worklet
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.postMessage({ command: 'flush' });
      } catch {
        // port may already be closed
      }
    }

    // Stop audio capture (disconnect worklet + release mic) but keep WS open
    // so the backend batch fallback can still send results.
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      sourceNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // already closed
      }
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Send a "stop" control message so the backend can trigger batch STT
    // transcription while the WebSocket is still open. Then wait for the
    // final transcript (or timeout) before tearing down the WebSocket.
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));

      // Wait for final transcript or timeout, then close WS.
      // Store in ref so it can be cleared on unmount.
      sttTimeoutRef.current = setTimeout(() => {
        sttTimeoutRef.current = null;
        ws.close();
        wsRef.current = null;
      }, BATCH_STT_TIMEOUT_MS);

      // The existing ws.onmessage handler delivers transcripts via callbacks.
      // Hook into onclose to clear the timeout if the server closes first.
      const origOnClose = ws.onclose;
      ws.onclose = (event) => {
        if (sttTimeoutRef.current !== null) {
          clearTimeout(sttTimeoutRef.current);
          sttTimeoutRef.current = null;
        }
        wsRef.current = null;
        if (origOnClose) origOnClose.call(ws, event);
      };
    } else {
      // WS already closed — just clean up
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // already closed
        }
        wsRef.current = null;
      }
    }

    isListeningRef.current = false;
    setIsListening(false);
    setListeningDuration(0);
    setPartialTranscript('');
  }, []);

  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  // ==========================================================================
  // TTS — Batch (speak full text)
  // ==========================================================================

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const engine = getAudioPlaybackEngine();
    const abortCtrl = new AbortController();
    ttsAbortRef.current = abortCtrl;

    setIsSpeaking(true);

    // Listen for playback end to clear isSpeaking
    const onEnded = () => {
      setIsSpeaking(false);
      engine.off('ended', onEnded);
    };
    engine.on('ended', onEnded);

    try {
      await synthesizeToPlayback(
        text,
        abortCtrl.signal,
        async (data, format) => {
          if (format === 'pcm') {
            engine.queuePCM(data, TTS_PCM_SAMPLE_RATE);
          } else {
            await engine.queueEncoded(data);
          }
        },
      );
    } catch (error: unknown) {
      // If aborted (barge-in or stop), clean up listener before returning
      if (error instanceof DOMException && error.name === 'AbortError') {
        engine.off('ended', onEnded);
        return;
      }
      setIsSpeaking(false);
      engine.off('ended', onEnded);
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    // Abort in-flight batch TTS requests
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }

    // Abort in-flight streaming TTS requests
    if (streamingAbortRef.current) {
      streamingAbortRef.current.abort();
      streamingAbortRef.current = null;
    }

    // Stop playback engine
    const engine = getAudioPlaybackEngine();
    engine.stop();

    setIsSpeaking(false);

    // Also clear any streaming sentence buffer
    sentenceBufferRef.current = '';
  }, []);

  // ==========================================================================
  // TTS — Streaming (sentence-by-sentence for live LLM output)
  // ==========================================================================

  /**
   * Send a single sentence to the TTS endpoint and queue the result.
   * Failures are silently ignored to avoid breaking the LLM token stream.
   */
  const synthesizeAndQueue = useCallback(async (sentence: string) => {
    if (!sentence.trim()) return;

    const engine = getAudioPlaybackEngine();

    // Mark speaking on the first sentence
    if (!engine.isPlaying) {
      setIsSpeaking(true);

      const onEnded = () => {
        setIsSpeaking(false);
        engine.off('ended', onEnded);
      };
      engine.on('ended', onEnded);
    }

    try {
      const signal = streamingAbortRef.current?.signal;
      await synthesizeToPlayback(sentence, signal, async (data, format) => {
        if (format === 'pcm') {
          engine.queuePCM(data, TTS_PCM_SAMPLE_RATE);
        } else {
          await engine.queueEncoded(data);
        }
      });
    } catch {
      // Non-critical: skip this sentence's audio silently.
      // TTS failures (including aborts) should not break the LLM stream.
    }
  }, []);

  const feedTokens = useCallback(
    (tokens: string) => {
      if (!streamingAbortRef.current) {
        streamingAbortRef.current = new AbortController();
      }
      sentenceBufferRef.current += tokens;

      // Extract complete sentences from the buffer
      let buffer = sentenceBufferRef.current;
      let match = SENTENCE_BOUNDARY_RE.exec(buffer);

      while (match) {
        // The sentence includes everything up to and including the punctuation
        const endIndex = match.index + match[1].length;
        const sentence = buffer.slice(0, endIndex).trim();

        if (sentence) {
          void synthesizeAndQueue(sentence);
        }

        // Advance the buffer past the matched boundary (including trailing whitespace)
        buffer = buffer.slice(match.index + match[0].length);
        match = SENTENCE_BOUNDARY_RE.exec(buffer);
      }

      sentenceBufferRef.current = buffer;
    },
    [synthesizeAndQueue],
  );

  const flushTokens = useCallback(() => {
    const remaining = sentenceBufferRef.current.trim();
    sentenceBufferRef.current = '';

    if (remaining) {
      void synthesizeAndQueue(remaining);
    }
  }, [synthesizeAndQueue]);

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  const isAvailable = settings.speech.sttEnabled || settings.speech.ttsEnabled;

  // ==========================================================================
  // Cleanup on unmount
  // ==========================================================================

  useEffect(() => {
    return () => {
      // Stop STT
      if (isListeningRef.current) {
        cleanupSTT();
        isListeningRef.current = false;
      }

      // Clear pending batch STT timeout
      if (sttTimeoutRef.current !== null) {
        clearTimeout(sttTimeoutRef.current);
        sttTimeoutRef.current = null;
      }
      if (partialDebounceRef.current !== null) {
        clearTimeout(partialDebounceRef.current);
        partialDebounceRef.current = null;
      }

      // Abort in-flight TTS
      if (ttsAbortRef.current) {
        ttsAbortRef.current.abort();
        ttsAbortRef.current = null;
      }

      // Clear streaming buffer
      sentenceBufferRef.current = '';
    };
  }, [cleanupSTT]);

  // ==========================================================================
  // Public API
  // ==========================================================================

  return {
    // STT
    startListening,
    stopListening,
    isListening,
    listeningDuration,
    partialTranscript,

    // TTS
    speak,
    stopSpeaking,
    isSpeaking,

    // TTS streaming
    feedTokens,
    flushTokens,

    // State
    isAvailable,
  };
}
