import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MIC_CONSTRAINTS,
  STT_SAMPLE_RATE,
  supportsAudioWorklet,
  WORKLET_NAME,
  WORKLET_PATH,
} from '@/shared/lib/audio-constants';

export interface UseMicCaptureOptions {
  onChunk?: (data: ArrayBuffer) => void;
  signal?: AbortSignal;
}

export interface UseMicCaptureReturn {
  start: () => Promise<MediaStream>;
  stop: () => void;
  isCapturing: boolean;
  stream: MediaStream | null;
}

export function useMicCapture(
  options?: UseMicCaptureOptions,
): UseMicCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const optionsRef = useRef(options);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const stop = useCallback(() => {
    try {
      workletRef.current?.port.postMessage({ command: 'flush' });
    } catch {
      // best effort
    }
    try {
      workletRef.current?.disconnect();
    } catch {
      // best effort
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      // best effort
    }
    try {
      void audioCtxRef.current?.close();
    } catch {
      // best effort
    }

    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    workletRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;
    setStream(null);
    setIsCapturing(false);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    if (!supportsAudioWorklet()) {
      throw new Error('AudioWorklet is required for low-latency mic capture.');
    }

    const abortHandler = () => stop();
    optionsRef.current?.signal?.addEventListener('abort', abortHandler, {
      once: true,
    });

    const nextStream = await navigator.mediaDevices.getUserMedia({
      ...MIC_CONSTRAINTS,
      audio: {
        ...(typeof MIC_CONSTRAINTS.audio === 'object'
          ? MIC_CONSTRAINTS.audio
          : {}),
        sampleRate: STT_SAMPLE_RATE,
        channelCount: 1,
      },
    });

    try {
      const audioCtx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
      await audioCtx.audioWorklet.addModule(WORKLET_PATH);
      const source = audioCtx.createMediaStreamSource(nextStream);
      const worklet = new AudioWorkletNode(audioCtx, WORKLET_NAME);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      worklet.port.onmessage = (event: MessageEvent) => {
        const data = event.data as ArrayBuffer | undefined;
        if (data?.byteLength) optionsRef.current?.onChunk?.(data);
      };

      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      streamRef.current = nextStream;
      audioCtxRef.current = audioCtx;
      sourceRef.current = source;
      workletRef.current = worklet;
      setStream(nextStream);
      setIsCapturing(true);
      return nextStream;
    } catch (err) {
      for (const track of nextStream.getTracks()) track.stop();
      throw err;
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { start, stop, isCapturing, stream };
}
