import { useCallback, useEffect, useRef, useState } from 'react';

interface VadInstance {
  start(): void;
  pause?(): void;
  destroy(): void;
}

export interface UseVadOptions {
  enabled?: boolean;
  stream?: MediaStream | null;
  positiveSpeechThreshold?: number;
  redemptionMs?: number;
  redemptionFrames?: number;
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onSpeechProbability?: (probability: number) => void;
}

export interface UseVadReturn {
  isReady: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useVad(options: UseVadOptions): UseVadReturn {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vadRef = useRef<VadInstance | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!options.enabled || !options.stream) return;
    let cancelled = false;

    async function init() {
      try {
        const { MicVAD } = await import('@ricky0123/vad-web');
        const vad = (await MicVAD.new({
          getStream: () => Promise.resolve(options.stream!),
          positiveSpeechThreshold: options.positiveSpeechThreshold ?? 0.6,
          redemptionMs:
            options.redemptionMs ?? (options.redemptionFrames ?? 8) * 30,
          onSpeechStart: () => optionsRef.current.onSpeechStart?.(),
          onSpeechEnd: (audio: Float32Array) =>
            optionsRef.current.onSpeechEnd?.(audio),
          onFrameProcessed: (probabilities: { isSpeech: number }) =>
            optionsRef.current.onSpeechProbability?.(probabilities.isSpeech),
        })) as VadInstance;

        if (cancelled) {
          vad.destroy();
          return;
        }

        vadRef.current = vad;
        vad.start();
        setError(null);
        setIsReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsReady(false);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      try {
        vadRef.current?.destroy();
      } catch {
        // best effort
      }
      vadRef.current = null;
      setIsReady(false);
    };
  }, [
    options.enabled,
    options.stream,
    options.positiveSpeechThreshold,
    options.redemptionMs,
    options.redemptionFrames,
  ]);

  const start = useCallback(() => {
    vadRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    if (vadRef.current?.pause) {
      vadRef.current.pause();
    } else {
      vadRef.current?.destroy();
      vadRef.current = null;
      setIsReady(false);
    }
  }, []);

  return { isReady, error, start, stop };
}
