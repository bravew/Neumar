import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import {
  MIC_CONSTRAINTS,
  STT_SAMPLE_RATE,
  supportsAudioWorklet,
  WORKLET_NAME,
  WORKLET_PATH,
} from '@/shared/lib/audio-constants';
import { getAudioPlaybackEngine } from '@/shared/lib/audio-playback';

import type { ClonedVoiceEntry, Voice } from '../types';

interface UseVoiceCloningOptions {
  setVoices: (voices: Voice[]) => void;
}

export function useVoiceCloning({ setVoices }: UseVoiceCloningOptions) {
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');
  const [cloneUploading, setCloneUploading] = useState(false);
  const [clonedVoices, setClonedVoices] = useState<ClonedVoiceEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cloneRecording, setCloneRecording] = useState(false);
  const [cloneRecordDuration, setCloneRecordDuration] = useState(0);
  const cloneAudioCtxRef = useRef<AudioContext | null>(null);
  const cloneWorkletRef = useRef<AudioWorkletNode | null>(null);
  const cloneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const cloneRecordStreamRef = useRef<MediaStream | null>(null);
  const clonePcmChunksRef = useRef<ArrayBuffer[]>([]);
  const cloneRecordTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/speech/voice-clone`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((data) => {
        if (data?.voices && Array.isArray(data.voices))
          setClonedVoices(data.voices);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          /* endpoint may not be available */
        }
      });
    return () => controller.abort();
  }, []);

  // Cleanup clone recording on unmount
  useEffect(() => {
    return () => {
      if (cloneRecordTimerRef.current)
        clearInterval(cloneRecordTimerRef.current);
      try {
        cloneWorkletRef.current?.disconnect();
      } catch {
        /* noop */
      }
      try {
        cloneSourceRef.current?.disconnect();
      } catch {
        /* noop */
      }
      try {
        cloneAudioCtxRef.current?.close();
      } catch {
        /* noop */
      }
      if (cloneRecordStreamRef.current) {
        for (const track of cloneRecordStreamRef.current.getTracks())
          track.stop();
      }
    };
  }, []);

  const refreshCloneVoicesAndVoices = useCallback(async () => {
    try {
      const [listRes, voicesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/speech/voice-clone`),
        fetch(`${API_BASE_URL}/speech/voices`),
      ]);
      const listData = await listRes.json();
      if (listData?.voices) setClonedVoices(listData.voices);
      const voicesData = await voicesRes.json();
      if (voicesData?.voices) setVoices(voicesData.voices);
    } catch {
      /* ignore */
    }
  }, [setVoices]);

  /** Build a 16-bit mono PCM WAV blob from Int16 PCM ArrayBuffer chunks. */
  const buildWavBlob = useCallback(
    (chunks: ArrayBuffer[], sampleRate: number): Blob => {
      let totalPcmBytes = 0;
      for (const chunk of chunks) totalPcmBytes += chunk.byteLength;
      const header = new ArrayBuffer(44);
      const v = new DataView(header);
      v.setUint8(0, 0x52);
      v.setUint8(1, 0x49);
      v.setUint8(2, 0x46);
      v.setUint8(3, 0x46); // "RIFF"
      v.setUint32(4, 36 + totalPcmBytes, true);
      v.setUint8(8, 0x57);
      v.setUint8(9, 0x41);
      v.setUint8(10, 0x56);
      v.setUint8(11, 0x45); // "WAVE"
      v.setUint8(12, 0x66);
      v.setUint8(13, 0x6d);
      v.setUint8(14, 0x74);
      v.setUint8(15, 0x20); // "fmt "
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, sampleRate, true);
      v.setUint32(28, sampleRate * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      v.setUint8(36, 0x64);
      v.setUint8(37, 0x61);
      v.setUint8(38, 0x74);
      v.setUint8(39, 0x61); // "data"
      v.setUint32(40, totalPcmBytes, true);
      return new Blob([header, ...chunks], { type: 'audio/wav' });
    },
    [],
  );

  const submitCloneAudio = useCallback(
    async (blob: Blob) => {
      if (!cloneName.trim()) return;
      setCloneUploading(true);
      setCloneError('');
      try {
        const formData = new FormData();
        formData.append('name', cloneName.trim());
        formData.append('file', blob, `${cloneName.trim()}.wav`);
        const res = await fetch(`${API_BASE_URL}/speech/voice-clone`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success)
          throw new Error(data.error ?? 'Upload failed');
        await refreshCloneVoicesAndVoices();
        setCloneName('');
      } catch (err) {
        setCloneError(err instanceof Error ? err.message : String(err));
      } finally {
        setCloneUploading(false);
      }
    },
    [cloneName, refreshCloneVoicesAndVoices],
  );

  const handleCloneUpload = useCallback(async () => {
    const fileInput = fileInputRef.current;
    if (!fileInput?.files?.length || !cloneName.trim()) return;
    const file = fileInput.files[0];
    if (!file) return;
    await submitCloneAudio(file);
    if (fileInput) fileInput.value = '';
  }, [cloneName, submitCloneAudio]);

  const handleCloneDelete = useCallback(
    async (name: string) => {
      try {
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        await fetch(`${API_BASE_URL}/speech/voice-clone/${safeName}`, {
          method: 'DELETE',
        });
        await refreshCloneVoicesAndVoices();
      } catch {
        /* ignore */
      }
    },
    [refreshCloneVoicesAndVoices],
  );

  const handleCloneTest = useCallback(async (voiceId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/speech/voice-clone/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      await getAudioPlaybackEngine().queueEncoded(await res.arrayBuffer());
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const startCloneRecording = useCallback(async () => {
    if (cloneRecording || !cloneName.trim()) return;
    setCloneError('');
    setCloneRecordDuration(0);
    clonePcmChunksRef.current = [];
    if (!supportsAudioWorklet()) {
      setCloneError('AudioWorklet not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      cloneRecordStreamRef.current = stream;
      const audioCtx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
      cloneAudioCtxRef.current = audioCtx;
      // Wrap remaining setup so mic + AudioContext are released if addModule() throws.
      try {
        await audioCtx.audioWorklet.addModule(WORKLET_PATH);
        const source = audioCtx.createMediaStreamSource(stream);
        cloneSourceRef.current = source;
        const workletNode = new AudioWorkletNode(audioCtx, WORKLET_NAME);
        cloneWorkletRef.current = workletNode;
        workletNode.port.onmessage = (event: MessageEvent) => {
          const data = event.data as ArrayBuffer | undefined;
          if (data && data.byteLength > 0) clonePcmChunksRef.current.push(data);
        };
        source.connect(workletNode);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        silentGain.connect(audioCtx.destination);
        workletNode.connect(silentGain);
        cloneRecordTimerRef.current = setInterval(() => {
          setCloneRecordDuration((prev) => prev + 1);
        }, 1_000);
        setCloneRecording(true);
      } catch (setupErr) {
        try {
          audioCtx.close();
        } catch {
          /* noop */
        }
        cloneAudioCtxRef.current = null;
        for (const track of stream.getTracks()) track.stop();
        cloneRecordStreamRef.current = null;
        throw setupErr;
      }
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    }
  }, [cloneRecording, cloneName]);

  const stopCloneRecording = useCallback(() => {
    if (cloneRecordTimerRef.current) {
      clearInterval(cloneRecordTimerRef.current);
      cloneRecordTimerRef.current = null;
    }
    setCloneRecording(false);
    setCloneRecordDuration(0);
    try {
      cloneWorkletRef.current?.port.postMessage({ command: 'flush' });
    } catch {
      /* noop */
    }
    setTimeout(() => {
      try {
        cloneWorkletRef.current?.disconnect();
      } catch {
        /* noop */
      }
      cloneWorkletRef.current = null;
      try {
        cloneSourceRef.current?.disconnect();
      } catch {
        /* noop */
      }
      cloneSourceRef.current = null;
      try {
        cloneAudioCtxRef.current?.close();
      } catch {
        /* noop */
      }
      cloneAudioCtxRef.current = null;
      if (cloneRecordStreamRef.current) {
        for (const track of cloneRecordStreamRef.current.getTracks())
          track.stop();
        cloneRecordStreamRef.current = null;
      }
      const chunks = clonePcmChunksRef.current;
      clonePcmChunksRef.current = [];
      if (chunks.length > 0)
        submitCloneAudio(buildWavBlob(chunks, STT_SAMPLE_RATE));
    }, 100);
  }, [buildWavBlob, submitCloneAudio]);

  return {
    cloneName,
    setCloneName,
    cloneError,
    cloneUploading,
    clonedVoices,
    fileInputRef,
    cloneRecording,
    cloneRecordDuration,
    handleCloneUpload,
    handleCloneDelete,
    handleCloneTest,
    startCloneRecording,
    stopCloneRecording,
  };
}
