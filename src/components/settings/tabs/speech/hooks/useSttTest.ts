import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import {
  MIC_CONSTRAINTS,
  STT_SAMPLE_RATE,
  supportsAudioWorklet,
  WORKLET_NAME,
  WORKLET_PATH,
} from '@/shared/lib/audio-constants';

/** Max time (ms) to wait for a batch STT result after sending the stop signal. */
const STT_TEST_TIMEOUT_MS = 15_000;

export type SttTestState = 'idle' | 'recording' | 'transcribing' | 'error';

export function useSttTest() {
  const [sttTestState, setSttTestState] = useState<SttTestState>('idle');
  const [sttTestTranscript, setSttTestTranscript] = useState('');
  const [sttTestPartial, setSttTestPartial] = useState('');
  const [sttTestError, setSttTestError] = useState('');
  const [sttTestDuration, setSttTestDuration] = useState(0);

  const sttWsRef = useRef<WebSocket | null>(null);
  const sttStreamRef = useRef<MediaStream | null>(null);
  const sttAudioCtxRef = useRef<AudioContext | null>(null);
  const sttWorkletRef = useRef<AudioWorkletNode | null>(null);
  const sttSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sttDurationTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const sttRecordingRef = useRef(false);
  const sttStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupSTTTest = useCallback(() => {
    if (sttDurationTimerRef.current !== null) {
      clearInterval(sttDurationTimerRef.current);
      sttDurationTimerRef.current = null;
    }
    if (sttWorkletRef.current) {
      try {
        sttWorkletRef.current.disconnect();
      } catch {
        /* noop */
      }
      sttWorkletRef.current = null;
    }
    if (sttSourceRef.current) {
      try {
        sttSourceRef.current.disconnect();
      } catch {
        /* noop */
      }
      sttSourceRef.current = null;
    }
    if (sttAudioCtxRef.current) {
      try {
        sttAudioCtxRef.current.close();
      } catch {
        /* noop */
      }
      sttAudioCtxRef.current = null;
    }
    if (sttStreamRef.current) {
      for (const track of sttStreamRef.current.getTracks()) track.stop();
      sttStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (sttStopTimeoutRef.current !== null) {
        clearTimeout(sttStopTimeoutRef.current);
        sttStopTimeoutRef.current = null;
      }
      if (sttRecordingRef.current) {
        cleanupSTTTest();
        if (sttWsRef.current) {
          try {
            sttWsRef.current.close();
          } catch {
            /* noop */
          }
          sttWsRef.current = null;
        }
        sttRecordingRef.current = false;
      }
    };
  }, [cleanupSTTTest]);

  const startSTTTest = useCallback(async () => {
    if (sttRecordingRef.current) return;

    setSttTestTranscript('');
    setSttTestPartial('');
    setSttTestError('');
    setSttTestDuration(0);

    if (!supportsAudioWorklet()) {
      setSttTestError('AudioWorklet not supported in this browser');
      setSttTestState('error');
      return;
    }

    try {
      const wsUrl = API_BASE_URL.replace(/^http/, 'ws') + '/speech/stt/stream';
      const ws = new WebSocket(wsUrl);
      sttWsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            text?: string;
            error?: string;
          };
          if (msg.type === 'partial' && msg.text) {
            setSttTestPartial(msg.text);
          } else if (msg.type === 'final' && msg.text) {
            setSttTestTranscript((prev) =>
              prev ? prev + ' ' + msg.text : msg.text!,
            );
            setSttTestPartial('');
          } else if (msg.type === 'error') {
            setSttTestError(msg.error ?? 'STT error');
            setSttTestState('error');
          }
        } catch {
          /* non-JSON */
        }
      };

      ws.onerror = () => {
        setSttTestError('WebSocket connection failed');
        setSttTestState('error');
        cleanupSTTTest();
        sttRecordingRef.current = false;
      };

      ws.onclose = () => {
        if (sttRecordingRef.current) {
          cleanupSTTTest();
          sttRecordingRef.current = false;
          setSttTestState('idle');
        }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        const prevErr = ws.onerror;
        ws.onerror = () => {
          reject(new Error('WebSocket connection failed'));
          if (prevErr) ws.onerror = prevErr;
        };
      });

      const mediaStream =
        await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      sttStreamRef.current = mediaStream;

      const audioCtx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
      sttAudioCtxRef.current = audioCtx;

      // Wrap remaining setup so cleanupSTTTest() is called if addModule() throws.
      try {
        await audioCtx.audioWorklet.addModule(WORKLET_PATH);

        const source = audioCtx.createMediaStreamSource(mediaStream);
        sttSourceRef.current = source;

        const workletNode = new AudioWorkletNode(audioCtx, WORKLET_NAME);
        sttWorkletRef.current = workletNode;

        workletNode.port.onmessage = (event: MessageEvent) => {
          const data = event.data as ArrayBuffer | undefined;
          if (
            data &&
            data.byteLength > 0 &&
            sttWsRef.current?.readyState === WebSocket.OPEN
          ) {
            sttWsRef.current.send(data);
          }
        };

        source.connect(workletNode);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        silentGain.connect(audioCtx.destination);
        workletNode.connect(silentGain);

        sttDurationTimerRef.current = setInterval(() => {
          setSttTestDuration((prev) => prev + 1);
        }, 1_000);

        sttRecordingRef.current = true;
        setSttTestState('recording');
      } catch (setupErr) {
        cleanupSTTTest();
        throw setupErr;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSttTestError(msg);
      setSttTestState('error');
      cleanupSTTTest();
      // Close the WebSocket opened before getUserMedia was called —
      // cleanupSTTTest() only handles audio resources, not the WS.
      if (sttWsRef.current) {
        try {
          sttWsRef.current.close();
        } catch {
          /* noop */
        }
        sttWsRef.current = null;
      }
    }
  }, [cleanupSTTTest]);

  const stopSTTTest = useCallback(() => {
    if (!sttRecordingRef.current) return;

    if (sttWorkletRef.current) {
      try {
        sttWorkletRef.current.port.postMessage({ command: 'flush' });
      } catch {
        /* noop */
      }
    }

    cleanupSTTTest();

    const ws = sttWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
      setSttTestState('transcribing');

      sttStopTimeoutRef.current = setTimeout(() => {
        sttStopTimeoutRef.current = null;
        ws.close();
        sttWsRef.current = null;
        setSttTestState((prev) => (prev === 'transcribing' ? 'idle' : prev));
      }, STT_TEST_TIMEOUT_MS);

      const origOnClose = ws.onclose;
      ws.onclose = (event) => {
        if (sttStopTimeoutRef.current !== null) {
          clearTimeout(sttStopTimeoutRef.current);
          sttStopTimeoutRef.current = null;
        }
        sttWsRef.current = null;
        setSttTestState((prev) => (prev === 'transcribing' ? 'idle' : prev));
        if (origOnClose) (origOnClose as (e: CloseEvent) => void)(event);
      };
    } else {
      if (sttWsRef.current) {
        try {
          sttWsRef.current.close();
        } catch {
          /* noop */
        }
        sttWsRef.current = null;
      }
      setSttTestState('idle');
    }

    sttRecordingRef.current = false;
    setSttTestDuration(0);
  }, [cleanupSTTTest]);

  return {
    sttTestState,
    sttTestTranscript,
    sttTestPartial,
    sttTestError,
    sttTestDuration,
    startSTTTest,
    stopSTTTest,
  };
}
